import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import type { PromptOrmEntity } from '../src/infrastructure/persistence/ai/prompt.orm-entity';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';
import { startRedisContainer, RedisTestEnv } from './utils/redis-testcontainer';

/**
 * Fake `SuggestionGenerator` swapped in via `overrideProvider` — this suite
 * never calls the real Anthropic API. `available` starts `true` so most
 * tests exercise the happy path; the "AI not configured" test flips it to
 * `false` for the duration of that one request, mirroring what
 * `NullSuggestionGenerator` would report with no `ANTHROPIC_API_KEY` set
 * (which is the actual case here — this suite never sets that env var).
 */
class FakeSuggestionGenerator {
  available = true;
  lastInput: { promptTemplate: string; originalText: string } | null = null;

  isAvailable(): boolean {
    return this.available;
  }

  generate(input: {
    promptTemplate: string;
    originalText: string;
  }): Promise<{ suggestedText: string }> {
    this.lastInput = input;
    return Promise.resolve({ suggestedText: `Better: ${input.originalText}` });
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
  let promptRepository: Repository<PromptOrmEntity>;
  let fakeGenerator: FakeSuggestionGenerator;

  async function registerAndLogin(email: string): Promise<string> {
    const payload = {
      email,
      password: 'correct-horse-battery-staple',
      display_name: 'Test User',
    };
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(payload)
      .expect(201);

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
      // Anthropic client.
      ANTHROPIC_API_KEY: '',
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
    const { PromptOrmEntity: PromptOrmEntityCtor } =
      await import('./../src/infrastructure/persistence/ai/prompt.orm-entity');

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

    promptRepository = app.get<Repository<PromptOrmEntity>>(
      getRepositoryToken(PromptOrmEntityCtor as typeof PromptOrmEntity),
    );
    // No public write path for prompts (repository-internal lookup only,
    // per CLAUDE.md) — seed the one this suite needs directly.
    await promptRepository.save(
      promptRepository.create({
        featureType: 'suggestion',
        version: 'v1',
        template: 'Improve this: {{content}}',
        isActive: true,
      }),
    );
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.container.stop();
    await mongo?.server.stop();
    await redis?.container.stop();
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

      expect(res.body).toMatchObject({
        section_id: sectionId,
        feature_type: 'suggestion',
        original_text: 'This is a rough draft paragraph.',
        suggested_text: 'Better: This is a rough draft paragraph.',
        status: 'pending',
        prompt_version: 'v1',
      });
      expect(res.body.id).toEqual(expect.any(String));
      expect(fakeGenerator.lastInput).toEqual({
        promptTemplate: 'Improve this: This is a rough draft paragraph.',
        originalText: 'This is a rough draft paragraph.',
        featureType: 'suggestion',
      });
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
