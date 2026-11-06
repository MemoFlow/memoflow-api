import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';
import { startRedisContainer, RedisTestEnv } from './utils/redis-testcontainer';
import { promoteToAdmin } from './utils/promote-admin';
import { registerUser } from './utils/register-user';

/** The text between the untrusted tags, so a reply never echoes the fence
 * (and with it the nonce), which the output guard rightly rejects. */
function fencedContent(user: string): string {
  // The v3 user template leads with a Context block; the section text is the
  // block after "Text:".
  const text = user.includes('\n\nText:\n')
    ? user.split('\n\nText:\n')[1]
    : user;
  return text.replace(/<\/?untrusted_[0-9a-f]+>\n?/g, '').replace(/\n$/, '');
}

/**
 * Fake `SuggestionGenerator` swapped in via `overrideProvider` — this suite
 * never calls the real LLM provider. `available` starts `true` so most
 * tests exercise the happy path; the "AI not configured" test flips it to
 * `false` for the duration of that one request, mirroring what
 * `NullSuggestionGenerator` would report with no `OPENROUTER_API_KEY` set
 * (which is the actual case here — this suite never sets that env var).
 */
class FakeSuggestionGenerator {
  available = true;
  lastInput: { system: string; user: string; featureType: string } | null =
    null;

  isAvailable(): boolean {
    return this.available;
  }

  generate(input: {
    system: string;
    user: string;
    featureType: string;
  }): Promise<{ suggestedText: string; model: string }> {
    this.lastInput = input;
    return Promise.resolve({
      suggestedText: `Better: ${fencedContent(input.user)}`,
      model: 'fake/model-1',
    });
  }
}

// Booting AppModule requires a live PostgreSQL and Redis (BullMQ planning
// queue used by the planning-jobs binding tests below), both provided by
// Testcontainers — gated identically to the other Docker-backed suites.
// MongoDB comes from mongodb-memory-server.
describeWithDocker()('AI layer (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;
  let fakeGenerator: FakeSuggestionGenerator;

  async function registerAndLogin(email: string): Promise<string> {
    const payload = {
      email,
      password: 'correct-horse-battery-staple',
      display_name: 'Test User',
    };
    await registerUser(app, payload);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);

    return loginRes.body.accessToken as string;
  }

  async function createDocument(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Q3 Planning', docType: 'blog' })
      .expect(201);
    return res.body.id as string;
  }

  async function createSection(
    token: string,
    documentId: string,
    overrides: Partial<{ title: string; content: string }> = {},
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: overrides.title ?? 'Intro',
        content: overrides.content ?? 'Hello world, this is a draft.',
      })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    redis = await startRedisContainer();
    Object.assign(process.env, pg.env, redis.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars-long',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
      COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
      // Deliberately unset — this suite exercises the "AI not configured"
      // path via the overridden SUGGESTION_GENERATOR below, never the real
      // LLM gateway.
      OPENROUTER_API_KEY: '',
    });

    // Apply migrations against the fresh test container before boot —
    // synchronize stays false everywhere, including tests.
    const dataSourceModule =
      await import('./../src/infrastructure/persistence/typeorm.data-source');
    const dataSource = dataSourceModule.default;
    dataSource.setOptions({
      host: pg.env.POSTGRES_HOST,
      port: Number(pg.env.POSTGRES_PORT),
      username: pg.env.POSTGRES_USER,
      password: pg.env.POSTGRES_PASSWORD,
      database: pg.env.POSTGRES_DB,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.destroy();

    // Import late so ConfigModule validation sees the test env vars, and so
    // these domain imports resolve against the same module instances the
    // app boots with.
    const { AppModule } = await import('./../src/app.module');
    const { SUGGESTION_GENERATOR } =
      await import('./../src/domain/ai/suggestion-generator.port');

    fakeGenerator = new FakeSuggestionGenerator();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUGGESTION_GENERATOR)
      .useValue(fakeGenerator)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.container.stop();
    await mongo?.server.stop();
    await redis?.container.stop();
  });

  describe('admin prompts (migration + /admin/prompts)', () => {
    let adminToken: string;
    let userToken: string;

    beforeAll(async () => {
      userToken = await registerAndLogin('prompts-user@example.com');
      await registerAndLogin('prompts-admin@example.com');
      await promoteToAdmin(pg.env, 'prompts-admin@example.com');
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'prompts-admin@example.com',
          password: 'correct-horse-battery-staple',
        })
        .expect(200);
      adminToken = res.body.accessToken as string;
    });

    const body = {
      feature_type: 'rewrite',
      version: 'v4',
      system_template: 'Sys <untrusted_{{nonce}}>',
      user_template: '<untrusted_{{nonce}}>{{content}}</untrusted_{{nonce}}>',
    };

    interface PromptBody {
      id: string;
      feature_type: string;
      version: string;
      is_active: boolean;
      user_invocable: boolean;
    }

    async function listPrompts(featureType?: string): Promise<PromptBody[]> {
      const res = await request(app.getHttpServer())
        .get('/admin/prompts')
        .query(featureType ? { feature_type: featureType } : {})
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      return res.body as PromptBody[];
    }

    it('migration leaves all five feature types with an active v3 prompt', async () => {
      const prompts = await listPrompts();
      const active = prompts.filter((p) => p.is_active);
      expect(active.map((p) => p.feature_type).sort()).toEqual([
        'expand',
        'planning',
        'rewrite',
        'suggestion',
        'summarize',
      ]);
      expect(active.every((p) => p.version === 'v3')).toBe(true);
      expect(
        Object.fromEntries(
          active.map((p) => [p.feature_type, p.user_invocable]),
        ),
      ).toEqual({
        expand: true,
        planning: false,
        rewrite: true,
        suggestion: true,
        summarize: true,
      });
    });

    it('rejects unauthenticated callers (401) and non-admins (403)', async () => {
      await request(app.getHttpServer()).get('/admin/prompts').expect(401);
      await request(app.getHttpServer())
        .get('/admin/prompts')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .post('/admin/prompts')
        .set('Authorization', `Bearer ${userToken}`)
        .send(body)
        .expect(403);
      await request(app.getHttpServer())
        .post('/admin/prompts/00000000-0000-0000-0000-000000000000/activate')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('filters the list by feature_type', async () => {
      const prompts = await listPrompts('planning');
      // The migrations leave v2 (inactive) and v3 (active).
      expect(prompts.map((p) => [p.version, p.is_active]).sort()).toEqual([
        ['v2', false],
        ['v3', true],
      ]);
      expect(prompts.every((p) => p.feature_type === 'planning')).toBe(true);
    });

    it('400s on an invalid body, an unknown type, a bad placeholder and a missing required one', async () => {
      const post = (payload: object) =>
        request(app.getHttpServer())
          .post('/admin/prompts')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(payload);

      await post({ ...body, version: undefined }).expect(400);
      await post({ ...body, version: 'x'.repeat(51) }).expect(400);
      await post({ ...body, system_template: 'x'.repeat(20001) }).expect(400);
      await post({ ...body, feature_type: 'poem' }).expect(400);
      await post({ ...body, system_template: 'Sys {{content}}' }).expect(400);
      await post({ ...body, system_template: 'Sys {{context}}' }).expect(400);
      await post({ ...body, user_template: '{{content}} {{foo-bar}}' }).expect(
        400,
      );
      await post({ ...body, user_template: '{{content}} {{oops' }).expect(400);
      await post({ ...body, user_template: '{{content}} {{prompt}}' }).expect(
        400,
      );
      await post({ ...body, system_template: 'Sys {{prompt}}' }).expect(400);
      await post({ ...body, user_template: 'no placeholder' }).expect(400);
      // The client cannot set user_invocable.
      await post({ ...body, version: 'v-extra', user_invocable: false }).expect(
        201,
      );
      const created = (await listPrompts('rewrite')).find(
        (p) => p.version === 'v-extra',
      );
      expect(created?.user_invocable).toBe(true);
    });

    it('creates an inactive prompt, 409s on a duplicate version, and activating switches the active one', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/admin/prompts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body)
        .expect(201);
      const created = createRes.body as PromptBody;
      expect(created).toMatchObject({
        feature_type: 'rewrite',
        version: 'v4',
        is_active: false,
        user_invocable: true,
      });

      await request(app.getHttpServer())
        .post('/admin/prompts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body)
        .expect(409);

      expect(
        (await listPrompts('rewrite')).filter((p) => p.is_active),
      ).toHaveLength(1);

      const activated = await request(app.getHttpServer())
        .post(`/admin/prompts/${created.id}/activate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((activated.body as PromptBody).is_active).toBe(true);

      const rewrite = await listPrompts('rewrite');
      const active = rewrite.filter((p) => p.is_active);
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(created.id);
      // Other feature types are untouched.
      expect(
        (await listPrompts('suggestion')).filter((p) => p.is_active),
      ).toHaveLength(1);

      // A user now gets the new version.
      const token = await registerAndLogin('prompts-rewrite@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);
      const sugg = await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'rewrite' })
        .expect(201);
      expect(sugg.body).toMatchObject({ prompt_version: 'v4' });
    });

    it('404s activating a missing prompt and 400s a non-uuid id', async () => {
      await request(app.getHttpServer())
        .post('/admin/prompts/00000000-0000-0000-0000-000000000000/activate')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .post('/admin/prompts/not-a-uuid/activate')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  describe('POST /sections/:sectionId/suggestions', () => {
    it('requires a token (401 without one)', async () => {
      await request(app.getHttpServer())
        .post('/sections/00000000-0000-0000-0000-000000000000/suggestions')
        .send({ featureType: 'suggestion' })
        .expect(401);
    });

    it('generates and persists a suggestion (happy path)', async () => {
      const token = await registerAndLogin('suggest-happy@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId, {
        content: 'This is a rough draft paragraph.',
      });

      const res = await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'suggestion' })
        .expect(201);

      // The prompt comes from the PromptsV3 migration, not a fixture.
      expect(res.body).toMatchObject({
        section_id: sectionId,
        feature_type: 'suggestion',
        original_text: 'This is a rough draft paragraph.',
        status: 'pending',
        prompt_version: 'v3',
        model: 'fake/model-1',
      });
      expect(res.body.id).toEqual(expect.any(String));
      const input = fakeGenerator.lastInput!;
      expect(input.featureType).toBe('suggestion');
      const nonce = /<untrusted_([0-9a-f]{32})>/.exec(input.system)?.[1];
      expect(nonce).toBeDefined();
      expect(input.system).toContain("MemoFlow's writing assistant");
      // v3: a Context block (document title and neighbouring headings, here
      // none) comes first, then the text.
      expect(input.user).toBe(
        `Context:\n<untrusted_${nonce}>\nDocument: Q3 Planning\n</untrusted_${nonce}>\n\nText:\n<untrusted_${nonce}>\nThis is a rough draft paragraph.\n</untrusted_${nonce}>`,
      );
      expect(res.body.suggested_text).toBe(
        'Better: This is a rough draft paragraph.',
      );
    });

    it('keeps $-sequences in the section content literal in the rendered prompt', async () => {
      const token = await registerAndLogin('suggest-dollar@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId, {
        content: 'Pay $& and $1 and {{nonce}}',
      });

      await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'suggestion' })
        .expect(201);

      expect(fakeGenerator.lastInput!.user).toContain(
        '\nPay $& and $1 and {{nonce}}\n',
      );
    });

    it('rejects the internal planning prompt with the same 404 as an unknown type', async () => {
      const token = await registerAndLogin('suggest-planning@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);
      fakeGenerator.lastInput = null;

      const planning = await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'planning' })
        .expect(404);
      const unknown = await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'unknown' })
        .expect(404);

      expect((planning.body as { message: string }).message).toBe(
        (unknown.body as { message: string }).message.replace(
          'unknown',
          'planning',
        ),
      );
      expect(fakeGenerator.lastInput).toBeNull();
    });

    it('returns 404 for a section not owned by the caller', async () => {
      const ownerToken = await registerAndLogin('suggest-owner@example.com');
      const documentId = await createDocument(ownerToken);
      const sectionId = await createSection(ownerToken, documentId);
      const otherToken = await registerAndLogin('suggest-other@example.com');

      await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ featureType: 'suggestion' })
        .expect(404);
    });

    it('returns 400 when featureType is missing', async () => {
      const token = await registerAndLogin('suggest-validation@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);

      await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('returns 404 when no active prompt is configured for the feature type', async () => {
      const token = await registerAndLogin('suggest-no-prompt@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);

      await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'not-a-configured-feature' })
        .expect(404);
    });

    it('returns 503 when the AI generator is not configured', async () => {
      const token = await registerAndLogin('suggest-unavailable@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);

      fakeGenerator.available = false;
      try {
        await request(app.getHttpServer())
          .post(`/sections/${sectionId}/suggestions`)
          .set('Authorization', `Bearer ${token}`)
          .send({ featureType: 'suggestion' })
          .expect(503);
      } finally {
        fakeGenerator.available = true;
      }
    });
  });

  describe('GET /sections/:sectionId/suggestions', () => {
    it('requires a token (401 without one)', async () => {
      await request(app.getHttpServer())
        .get('/sections/00000000-0000-0000-0000-000000000000/suggestions')
        .expect(401);
    });

    it('lists suggestions for a section, newest first', async () => {
      const token = await registerAndLogin('suggest-list@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);

      await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'suggestion' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ section_id: sectionId });
    });

    it('returns 404 for a section not owned by the caller', async () => {
      const ownerToken = await registerAndLogin(
        'suggest-list-owner@example.com',
      );
      const documentId = await createDocument(ownerToken);
      const sectionId = await createSection(ownerToken, documentId);
      const otherToken = await registerAndLogin(
        'suggest-list-other@example.com',
      );

      await request(app.getHttpServer())
        .get(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });
  });

  describe('PATCH /suggestions/:id', () => {
    it('requires a token (401 without one)', async () => {
      await request(app.getHttpServer())
        .patch('/suggestions/00000000-0000-0000-0000-000000000000')
        .send({ status: 'accepted' })
        .expect(401);
    });

    it('accepts a pending suggestion', async () => {
      const token = await registerAndLogin('review-accept@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);
      const createRes = await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'suggestion' })
        .expect(201);
      const suggestionId = createRes.body.id as string;

      const res = await request(app.getHttpServer())
        .patch(`/suggestions/${suggestionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'accepted' })
        .expect(200);

      expect(res.body.status).toBe('accepted');
    });

    it('rejects a pending suggestion', async () => {
      const token = await registerAndLogin('review-reject@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);
      const createRes = await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'suggestion' })
        .expect(201);
      const suggestionId = createRes.body.id as string;

      const res = await request(app.getHttpServer())
        .patch(`/suggestions/${suggestionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'rejected' })
        .expect(200);

      expect(res.body.status).toBe('rejected');
    });

    it('returns 409 when reviewing an already-reviewed suggestion', async () => {
      const token = await registerAndLogin('review-conflict@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);
      const createRes = await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'suggestion' })
        .expect(201);
      const suggestionId = createRes.body.id as string;

      await request(app.getHttpServer())
        .patch(`/suggestions/${suggestionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'accepted' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/suggestions/${suggestionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'rejected' })
        .expect(409);
    });

    it('returns 404 for a suggestion not owned by the caller', async () => {
      const ownerToken = await registerAndLogin('review-owner@example.com');
      const documentId = await createDocument(ownerToken);
      const sectionId = await createSection(ownerToken, documentId);
      const createRes = await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ featureType: 'suggestion' })
        .expect(201);
      const suggestionId = createRes.body.id as string;
      const otherToken = await registerAndLogin('review-other@example.com');

      await request(app.getHttpServer())
        .patch(`/suggestions/${suggestionId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ status: 'accepted' })
        .expect(404);
    });

    it('returns 400 for an invalid status value', async () => {
      const token = await registerAndLogin('review-bad-status@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);
      const createRes = await request(app.getHttpServer())
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ featureType: 'suggestion' })
        .expect(201);
      const suggestionId = createRes.body.id as string;

      await request(app.getHttpServer())
        .patch(`/suggestions/${suggestionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'pending' })
        .expect(400);
    });
  });

  describe('POST /planning-jobs (documentId/sectionId binding)', () => {
    it('binds documentId/sectionId when owned by the caller', async () => {
      const token = await registerAndLogin('planning-bind@example.com');
      const documentId = await createDocument(token);
      const sectionId = await createSection(token, documentId);

      const res = await request(app.getHttpServer())
        .post('/planning-jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: 'Plan this section', documentId, sectionId })
        .expect(202);

      expect(res.body).toMatchObject({
        status: 'pending',
        document_id: documentId,
        section_id: sectionId,
      });
    });

    it('returns 404 when documentId is not owned by the caller', async () => {
      const ownerToken = await registerAndLogin('planning-owner@example.com');
      const documentId = await createDocument(ownerToken);
      const otherToken = await registerAndLogin('planning-other@example.com');

      await request(app.getHttpServer())
        .post('/planning-jobs')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ prompt: 'Plan this section', documentId })
        .expect(404);
    });

    it('returns 404 when sectionId does not exist', async () => {
      const token = await registerAndLogin(
        'planning-missing-section@example.com',
      );

      await request(app.getHttpServer())
        .post('/planning-jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({
          prompt: 'Plan this section',
          sectionId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(404);
    });

    it('returns 400 when documentId is not a valid uuid', async () => {
      const token = await registerAndLogin('planning-bad-uuid@example.com');

      await request(app.getHttpServer())
        .post('/planning-jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: 'Plan this section', documentId: 'not-a-uuid' })
        .expect(400);
    });
  });
});
