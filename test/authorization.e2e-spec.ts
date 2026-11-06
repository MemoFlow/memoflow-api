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
import { promoteToAdmin, setUserRole } from './utils/promote-admin';
import { startRedisContainer, RedisTestEnv } from './utils/redis-testcontainer';

const PASSWORD = 'correct-horse-battery-staple';

/** Stand-in for the external suggestion generator; never calls a real API. */
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

class FakeSuggestionGenerator {
  isAvailable(): boolean {
    return true;
  }

  generate(input: {
    system: string;
    user: string;
    featureType: string;
  }): Promise<{ suggestedText: string; model: string }> {
    return Promise.resolve({
      suggestedText: `Better: ${fencedContent(input.user)}`,
      model: 'fake/model-1',
    });
  }
}

interface TestUser {
  id: string;
  email: string;
  token: string;
}

describeWithDocker()('Authorization (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;
  let counter = 0;

  function http() {
    return request(app.getHttpServer());
  }

  async function login(email: string): Promise<string> {
    const res = await http()
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function registerUser(
    options: { admin?: boolean } = {},
  ): Promise<TestUser> {
    counter += 1;
    const email = `authz-user-${counter}@example.com`;
    await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, display_name: `User ${counter}` })
      .expect(202);
    if (options.admin) {
      await promoteToAdmin(pg.env, email);
    }
    const token = await login(email);
    const me = await http()
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return { id: me.body.id as string, email, token };
  }

  function templatePayload(isPublished = false) {
    return {
      title: 'Standard Blog Post',
      docType: 'blog',
      scope: 'personal',
      isPublished,
      sections: [
        { title: 'Intro', order: 0, wordCountMin: 20, wordCountMax: 100 },
      ],
    };
  }

  async function createTemplate(
    user: TestUser,
    isPublished = false,
  ): Promise<string> {
    const res = await http()
      .post('/templates')
      .set('Authorization', `Bearer ${user.token}`)
      .send(templatePayload(isPublished))
      .expect(201);
    return res.body.id as string;
  }

  async function createDocument(user: TestUser): Promise<string> {
    const res = await http()
      .post('/documents')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ title: 'Q3 Planning', docType: 'blog' })
      .expect(201);
    return res.body.id as string;
  }

  async function createSection(
    user: TestUser,
    documentId: string,
  ): Promise<string> {
    const res = await http()
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ title: 'Intro', content: 'Hello world, this is a draft.' })
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

    // Import late so ConfigModule validation sees the test env vars.
    const { AppModule } = await import('./../src/app.module');
    const { SUGGESTION_GENERATOR } =
      await import('./../src/domain/ai/suggestion-generator.port');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUGGESTION_GENERATOR)
      .useValue(new FakeSuggestionGenerator())
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

  describe('template publishing', () => {
    it('rejects a non-admin publishing on create (403)', async () => {
      const user = await registerUser();
      await http()
        .post('/templates')
        .set('Authorization', `Bearer ${user.token}`)
        .send(templatePayload(true))
        .expect(403);
    });

    it('rejects a non-admin publishing on update (403)', async () => {
      const user = await registerUser();
      const templateId = await createTemplate(user);
      await http()
        .patch(`/templates/${templateId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ isPublished: true })
        .expect(403);
    });

    it('rejects a non-admin editing a published template, but allows deleting their own', async () => {
      // A published template can only exist for a non-admin owner if it was
      // published before the owner's role changed (e.g. legacy rows).
      const owner = await registerUser({ admin: true });
      const publishedId = await createTemplate(owner, true);
      await setUserRole(pg.env, owner.email, 'user');

      await http()
        .patch(`/templates/${publishedId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ title: 'Renamed' })
        .expect(403);
      await http()
        .delete(`/templates/${publishedId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(204);
    });

    it("lets an admin edit, unpublish and delete another user's and a published template", async () => {
      const admin = await registerUser({ admin: true });
      const author = await registerUser();
      const privateId = await createTemplate(author);
      const publishedId = await createTemplate(
        await registerUser({ admin: true }),
        true,
      );

      await http()
        .patch(`/templates/${privateId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ title: 'Edited by admin' })
        .expect(200);
      const unpublished = await http()
        .patch(`/templates/${publishedId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isPublished: false })
        .expect(200);
      expect(unpublished.body.is_published).toBe(false);

      await http()
        .delete(`/templates/${privateId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204);
      await http()
        .delete(`/templates/${publishedId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204);
    });
  });

  describe('template created_by visibility', () => {
    it('shows created_by to the owner and an admin, and hides it from others', async () => {
      const owner = await registerUser({ admin: true });
      const templateId = await createTemplate(owner, true);
      const other = await registerUser();
      const admin = await registerUser({ admin: true });

      const asOwner = await http()
        .get(`/templates/${templateId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      const asAdmin = await http()
        .get(`/templates/${templateId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      const asOther = await http()
        .get(`/templates/${templateId}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);

      expect(asOwner.body.created_by).toBe(owner.id);
      expect(asAdmin.body.created_by).toBe(owner.id);
      expect(asOther.body.created_by).toBeNull();

      const list = await http()
        .get('/templates')
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);
      const listed = (
        list.body as { id: string; created_by: string | null }[]
      ).find((t) => t.id === templateId);
      expect(listed?.created_by).toBeNull();
    });
  });

  describe('GET /users/:id', () => {
    it('returns 404 for another user, 200 for self, and 200 for an admin', async () => {
      const a = await registerUser();
      const b = await registerUser();
      const admin = await registerUser({ admin: true });

      await http()
        .get(`/users/${b.id}`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(404);
      const self = await http()
        .get(`/users/${a.id}`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200);
      expect(self.body.id).toBe(a.id);
      expect(self.body).not.toHaveProperty('disabled_at');
      expect(self.body).not.toHaveProperty('password_hash');

      const asAdmin = await http()
        .get(`/users/${a.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(asAdmin.body.id).toBe(a.id);
      expect(asAdmin.body.disabled_at).toBeNull();
    });
  });

  describe('leaderboard', () => {
    it('has is_me and no user_id', async () => {
      const me = await registerUser();
      await createDocument(me);
      const other = await registerUser();

      const res = await http()
        .get('/gamification/leaderboard?limit=50')
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);
      const entries = res.body as Record<string, unknown>[];
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry).not.toHaveProperty('user_id');
        expect(typeof entry.is_me).toBe('boolean');
      }
      expect(entries.filter((e) => e.is_me).length).toBeLessThanOrEqual(1);
    });

    it("flags the requesting user's own entry", async () => {
      const me = await registerUser();
      await createDocument(me);
      // The XP award is applied asynchronously; poll until the entry ranks.
      let mine: Record<string, unknown> | undefined;
      for (let i = 0; i < 50 && !mine; i += 1) {
        const res = await http()
          .get('/gamification/leaderboard?limit=50')
          .set('Authorization', `Bearer ${me.token}`)
          .expect(200);
        mine = (res.body as Record<string, unknown>[]).find((e) => e.is_me);
        if (!mine) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(mine).toBeDefined();
    });
  });

  describe('disabled accounts', () => {
    it('blocks login and an existing token while disabled, and enable restores both', async () => {
      const admin = await registerUser({ admin: true });
      const target = await registerUser();

      await http()
        .post(`/users/${target.id}/disable`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204);
      // Idempotent.
      await http()
        .post(`/users/${target.id}/disable`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204);

      const loginRes = await http()
        .post('/auth/login')
        .send({ email: target.email, password: PASSWORD })
        .expect(401);
      expect(loginRes.body.message).toBe('Invalid email or password');
      await http()
        .get('/users/me')
        .set('Authorization', `Bearer ${target.token}`)
        .expect(401);

      const adminView = await http()
        .get(`/users/${target.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(adminView.body.disabled_at).toEqual(expect.any(String));

      await http()
        .post(`/users/${target.id}/enable`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204);
      await http()
        .post(`/users/${target.id}/enable`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204);

      await http()
        .get('/users/me')
        .set('Authorization', `Bearer ${target.token}`)
        .expect(200);
      await login(target.email);
    });

    it('excludes disabled users from the leaderboard', async () => {
      const admin = await registerUser({ admin: true });
      const target = await registerUser();
      await createDocument(target);
      const viewer = await registerUser();
      const targetName = (
        await http()
          .get('/users/me')
          .set('Authorization', `Bearer ${target.token}`)
          .expect(200)
      ).body.display_name as string;

      const names = async () =>
        (
          (
            await http()
              .get('/gamification/leaderboard?limit=50')
              .set('Authorization', `Bearer ${viewer.token}`)
              .expect(200)
          ).body as { display_name: string }[]
        ).map((e) => e.display_name);

      // Display names are unique per registered test user.
      // The XP award is applied asynchronously; wait until it ranks.
      for (let i = 0; i < 50 && !(await names()).includes(targetName); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await names()).toContain(targetName);
      await http()
        .post(`/users/${target.id}/disable`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204);
      expect(await names()).not.toContain(targetName);
    });

    it('returns 403 for a non-admin disabling or enabling', async () => {
      const user = await registerUser();
      const target = await registerUser();
      await http()
        .post(`/users/${target.id}/disable`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(403);
      await http()
        .post(`/users/${target.id}/enable`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(403);
    });

    it('returns 400 when an admin disables their own account', async () => {
      const admin = await registerUser({ admin: true });
      await http()
        .post(`/users/${admin.id}/disable`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(400);
    });

    it('returns 404 for an unknown user id', async () => {
      const admin = await registerUser({ admin: true });
      const unknown = '11111111-1111-4111-8111-111111111111';
      await http()
        .post(`/users/${unknown}/disable`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(404);
      await http()
        .post(`/users/${unknown}/enable`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(404);
    });
  });

  describe('cross-user matrix: user B against user A resources', () => {
    let a: TestUser;
    let b: TestUser;
    let documentId: string;
    let sectionId: string;
    let secondSectionId: string;
    let versionId: string;
    let templateId: string;
    let suggestionId: string;
    let bDocumentId: string;
    let bPublishedTemplateId: string;

    beforeAll(async () => {
      a = await registerUser();
      b = await registerUser();
      documentId = await createDocument(a);
      sectionId = await createSection(a, documentId);
      secondSectionId = await createSection(a, documentId);
      const versionRes = await http()
        .post(`/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ label: 'v1' })
        .expect(201);
      versionId = versionRes.body.id as string;
      templateId = await createTemplate(a);
      const suggestionRes = await http()
        .post(`/sections/${sectionId}/suggestions`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ featureType: 'suggestion' })
        .expect(201);
      suggestionId = suggestionRes.body.id as string;
      bDocumentId = await createDocument(b);
      const admin = await registerUser({ admin: true });
      bPublishedTemplateId = await createTemplate(admin, true);
    });

    const auth = () => ({ Authorization: `Bearer ${b.token}` });

    it('documents: get, update, delete, list', async () => {
      await http().get(`/documents/${documentId}`).set(auth()).expect(404);
      await http()
        .patch(`/documents/${documentId}`)
        .set(auth())
        .send({ title: 'Taken' })
        .expect(404);
      await http().delete(`/documents/${documentId}`).set(auth()).expect(404);
      const list = await http().get('/documents').set(auth()).expect(200);
      expect(
        (list.body as { id: string }[]).some((d) => d.id === documentId),
      ).toBe(false);
    });

    it('sections: list, create, get, update, delete, reorder', async () => {
      const base = `/documents/${documentId}/sections`;
      await http().get(base).set(auth()).expect(404);
      await http()
        .post(base)
        .set(auth())
        .send({ title: 'X', content: 'y' })
        .expect(404);
      await http().get(`${base}/${sectionId}`).set(auth()).expect(404);
      await http()
        .patch(`${base}/${sectionId}`)
        .set(auth())
        .send({ title: 'Taken' })
        .expect(404);
      await http().delete(`${base}/${sectionId}`).set(auth()).expect(404);
      await http()
        .patch(`${base}/reorder`)
        .set(auth())
        .send({ sectionIds: [secondSectionId, sectionId] })
        .expect(404);
    });

    it("sections: B's own document with A's section id is 404", async () => {
      const base = `/documents/${bDocumentId}/sections`;
      await http().get(`${base}/${sectionId}`).set(auth()).expect(404);
      await http()
        .patch(`${base}/${sectionId}`)
        .set(auth())
        .send({ title: 'Taken' })
        .expect(404);
      await http().delete(`${base}/${sectionId}`).set(auth()).expect(404);
    });

    it('versions: save, list, get, restore', async () => {
      const base = `/documents/${documentId}/versions`;
      await http().post(base).set(auth()).send({}).expect(404);
      await http().get(base).set(auth()).expect(404);
      await http().get(`${base}/${versionId}`).set(auth()).expect(404);
      await http().post(`${base}/${versionId}/restore`).set(auth()).expect(404);
    });

    it("versions: B's own document with A's version id is 404", async () => {
      const base = `/documents/${bDocumentId}/versions`;
      await http().get(`${base}/${versionId}`).set(auth()).expect(404);
      await http().post(`${base}/${versionId}/restore`).set(auth()).expect(404);
    });

    it('suggestions: list, generate and review', async () => {
      await http()
        .get(`/sections/${sectionId}/suggestions`)
        .set(auth())
        .expect(404);
      await http()
        .post(`/sections/${sectionId}/suggestions`)
        .set(auth())
        .send({ featureType: 'suggestion' })
        .expect(404);
      await http()
        .patch(`/suggestions/${suggestionId}`)
        .set(auth())
        .send({ status: 'accepted' })
        .expect(404);
      // The suggestion is untouched: its owner can still accept it.
      await http()
        .patch(`/suggestions/${suggestionId}`)
        .set({ Authorization: `Bearer ${a.token}` })
        .send({ status: 'accepted' })
        .expect(200);
    });

    it("templates: get, update, delete and apply on A's unpublished template", async () => {
      await http().get(`/templates/${templateId}`).set(auth()).expect(404);
      await http()
        .patch(`/templates/${templateId}`)
        .set(auth())
        .send({ title: 'Taken' })
        .expect(404);
      await http().delete(`/templates/${templateId}`).set(auth()).expect(404);
      await http()
        .post(`/templates/${templateId}/apply`)
        .set(auth())
        .send({ documentId: bDocumentId })
        .expect(404);
    });

    it("apply-template: applying a visible template to A's document is 404", async () => {
      await http()
        .post(`/templates/${bPublishedTemplateId}/apply`)
        .set(auth())
        .send({ documentId })
        .expect(404);
    });

    it('planning jobs: submit bound to A resources and read A job', async () => {
      await http()
        .post('/planning-jobs')
        .set(auth())
        .send({ prompt: 'Plan', documentId })
        .expect(404);
      await http()
        .post('/planning-jobs')
        .set(auth())
        .send({ prompt: 'Plan', sectionId })
        .expect(404);

      const submitted = await http()
        .post('/planning-jobs')
        .set({ Authorization: `Bearer ${a.token}` })
        .send({ prompt: 'Plan', documentId })
        .expect(202);
      await http()
        .get(`/planning-jobs/${submitted.body.id as string}`)
        .set(auth())
        .expect(404);
    });

    it('A resources are still intact after B attempts', async () => {
      await http()
        .get(`/documents/${documentId}/sections/${sectionId}`)
        .set({ Authorization: `Bearer ${a.token}` })
        .expect(200);
      await http()
        .get(`/templates/${templateId}`)
        .set({ Authorization: `Bearer ${a.token}` })
        .expect(200);
    });
  });
});
