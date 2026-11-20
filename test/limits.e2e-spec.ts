import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';
import { promoteToAdmin } from './utils/promote-admin';
import { registerUser } from './utils/register-user';
import { stopContainer } from './utils/stop-container';
import {
  DEFAULT_STORAGE_LIMITS,
  STORAGE_LIMITS,
} from './../src/domain/limits/storage-limits';
import { applyBodyLimits } from './../src/shared/http/body-limit';
import { HttpExceptionFilter } from './../src/shared/filters/http-exception.filter';

// Phase 4 ("Limits"): input size caps, template pagination, controlled
// scope/doc_type, admin-only global scope, and per-user storage caps. The
// caps are lowered through the STORAGE_LIMITS provider so the suite doesn't
// have to create 200 rows.
const LIMITS = {
  ...DEFAULT_STORAGE_LIMITS,
  maxDocumentsPerUser: 3,
  maxSectionsPerDocument: 3,
  maxVersionsPerDocument: 2,
  maxTemplatesPerUser: 2,
};

describeWithDocker()('Limits (e2e)', () => {
  let app: NestExpressApplication;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;

  async function registerAndLogin(email: string): Promise<string> {
    const payload = {
      email,
      password: 'correct-horse-battery-staple',
      display_name: 'Test User',
    };
    await registerUser(app, payload);
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: payload.password })
      .expect(200);
    return loginRes.body.accessToken as string;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function postDocument(token: string, extra: object = {}) {
    return request(app.getHttpServer())
      .post('/documents')
      .set(auth(token))
      .send({ title: 'Doc', docType: 'blog', ...extra });
  }

  async function createDocument(token: string): Promise<string> {
    const res = await postDocument(token).expect(201);
    return res.body.id as string;
  }

  function postSection(token: string, documentId: string, extra = {}) {
    return request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set(auth(token))
      .send({ title: 'S', content: 'hello world', ...extra });
  }

  const templateBody = (overrides: object = {}, sectionCount = 1) => ({
    title: 'Template',
    docType: 'blog',
    scope: 'personal',
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      title: `S${i}`,
      order: i,
      wordCountMin: 1,
      wordCountMax: 10,
    })),
    ...overrides,
  });

  function postTemplate(token: string, overrides: object = {}, count = 1) {
    return request(app.getHttpServer())
      .post('/templates')
      .set(auth(token))
      .send(templateBody(overrides, count));
  }

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    Object.assign(process.env, pg.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars-long',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
      COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
    });

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

    const { AppModule } = await import('./../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(STORAGE_LIMITS)
      .useValue(LIMITS)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    applyBodyLimits(app);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await stopContainer(pg?.container);
    await mongo?.server.stop();
  });

  describe('input size limits', () => {
    it('rejects an over-long document title with 400', async () => {
      const token = await registerAndLogin('limits-title@example.com');
      const res = await postDocument(token, { title: 't'.repeat(201) }).expect(
        400,
      );
      expect(JSON.stringify(res.body.message)).toContain('title');
      await postDocument(token, { title: 't'.repeat(200) }).expect(201);
    });

    it('rejects oversize section content with 400 but accepts the boundary', async () => {
      const token = await registerAndLogin('limits-content@example.com');
      const documentId = await createDocument(token);
      await postSection(token, documentId, {
        content: 'c'.repeat(100_001),
      }).expect(400);
      await postSection(token, documentId, {
        content: 'c'.repeat(100_000),
      }).expect(201);
    });

    it('rejects an oversized styleConfig with 400', async () => {
      const token = await registerAndLogin('limits-style@example.com');
      await postDocument(token, {
        styleConfig: { blob: 'x'.repeat(10_300) },
      }).expect(400);
    });

    it('rejects a body above the 1 MB JSON limit with 413', async () => {
      const token = await registerAndLogin('limits-body@example.com');
      await postDocument(token, { title: 't'.repeat(1_100_000) }).expect(413);
    });

    it('rejects an unknown docType on documents and templates', async () => {
      const token = await registerAndLogin('limits-doctype@example.com');
      await postDocument(token, { docType: 'Blog' }).expect(400);
      await postTemplate(token, { docType: 'filter-blog' }).expect(400);
      await postTemplate(token, { scope: 'everyone' }).expect(400);
    });
  });

  describe('GET /templates pagination', () => {
    it('defaults to 20, caps limit at 100 and pages with offset', async () => {
      const admin = 'limits-pagination-admin@example.com';
      const token = await registerAndLogin(admin);
      await promoteToAdmin(pg.env, admin);
      // Admins are exempt from the template cap, so 25 rows are fine.
      for (let i = 0; i < 25; i += 1) {
        await postTemplate(token, {
          title: `Paged ${String(i).padStart(2, '0')}`,
          docType: 'report',
          scope: 'org',
        }).expect(201);
      }
      const list = (query: object) =>
        request(app.getHttpServer())
          .get('/templates')
          .query({ docType: 'report', scope: 'org', ...query })
          .set(auth(token));

      const first = await list({}).expect(200);
      expect(first.body).toHaveLength(20);

      const page1 = await list({ limit: 10, offset: 0 }).expect(200);
      const page2 = await list({ limit: 10, offset: 10 }).expect(200);
      const ids1: string[] = page1.body.map((t: { id: string }) => t.id);
      const ids2: string[] = page2.body.map((t: { id: string }) => t.id);
      expect(ids1).toHaveLength(10);
      expect(ids2).toHaveLength(10);
      expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);

      const rest = await list({ limit: 100, offset: 20 }).expect(200);
      expect(rest.body).toHaveLength(5);

      await list({ limit: 101 }).expect(400);
      await list({ limit: 0 }).expect(400);
      await list({ offset: -1 }).expect(400);
    });
  });

  describe("template scope 'global'", () => {
    it('is admin-only on create and update (403 for a regular user)', async () => {
      const token = await registerAndLogin('limits-global-user@example.com');
      await postTemplate(token, { scope: 'global' }).expect(403);

      const created = await postTemplate(token).expect(201);
      await request(app.getHttpServer())
        .patch(`/templates/${created.body.id as string}`)
        .set(auth(token))
        .send({ scope: 'global' })
        .expect(403);

      const adminEmail = 'limits-global-admin@example.com';
      const adminToken = await registerAndLogin(adminEmail);
      await promoteToAdmin(pg.env, adminEmail);
      const global = await postTemplate(adminToken, {
        scope: 'global',
        docType: 'thesis',
      }).expect(201);
      expect(global.body.scope).toBe('global');
      await request(app.getHttpServer())
        .patch(`/templates/${created.body.id as string}`)
        .set(auth(adminToken))
        .send({ scope: 'global' })
        .expect(200);
    });
  });

  describe('storage caps (409, no pruning)', () => {
    it('caps documents per user and frees a slot on delete', async () => {
      const token = await registerAndLogin('limits-docs@example.com');
      const ids = [
        await createDocument(token),
        await createDocument(token),
        await createDocument(token),
      ];

      const res = await postDocument(token).expect(409);
      expect(res.body).toMatchObject({
        statusCode: 409,
        message: 'Document limit reached (3)',
      });

      // Another user is unaffected.
      const other = await registerAndLogin('limits-docs-other@example.com');
      await createDocument(other);

      // Nothing was pruned, and deleting one frees exactly one slot.
      const listed = await request(app.getHttpServer())
        .get('/documents')
        .set(auth(token))
        .expect(200);
      expect(listed.body).toHaveLength(3);
      await request(app.getHttpServer())
        .delete(`/documents/${ids[0]}`)
        .set(auth(token))
        .expect(204);
      await postDocument(token).expect(201);
    });

    it('is race-safe: parallel creates never overshoot the document cap', async () => {
      const token = await registerAndLogin('limits-race@example.com');
      const results = await Promise.all(
        Array.from({ length: 8 }, () => postDocument(token)),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    });

    it('caps sections per document', async () => {
      const token = await registerAndLogin('limits-sections@example.com');
      const documentId = await createDocument(token);
      await postSection(token, documentId).expect(201);
      await postSection(token, documentId).expect(201);
      await postSection(token, documentId).expect(201);
      const res = await postSection(token, documentId).expect(409);
      expect(res.body.message).toBe('Section limit reached (3)');
    });

    it('is race-safe: parallel section creates never overshoot the cap', async () => {
      const token = await registerAndLogin('limits-sec-race@example.com');
      const documentId = await createDocument(token);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => postSection(token, documentId)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    });

    it('applying a template respects the section cap', async () => {
      const token = await registerAndLogin('limits-apply@example.com');
      const documentId = await createDocument(token);
      await postSection(token, documentId).expect(201);
      // 2 sections fit alongside the existing one (cap 3); 3 do not.
      const fits = await postTemplate(token, {}, 2).expect(201);
      await request(app.getHttpServer())
        .post(`/templates/${fits.body.id as string}/apply`)
        .set(auth(token))
        .send({ documentId })
        .expect(201);

      const otherDocument = await createDocument(token);
      await postSection(token, otherDocument).expect(201);
      await postSection(token, otherDocument).expect(201);
      const tooBig = await request(app.getHttpServer())
        .post(`/templates/${fits.body.id as string}/apply`)
        .set(auth(token))
        .send({ documentId: otherDocument })
        .expect(409);
      expect(tooBig.body.message).toBe('Section limit reached (3)');

      // Nothing partial was written.
      const sections = await request(app.getHttpServer())
        .get(`/documents/${otherDocument}/sections`)
        .set(auth(token))
        .expect(200);
      expect(sections.body).toHaveLength(2);
    });

    it('caps versions per document (soft cap)', async () => {
      const token = await registerAndLogin('limits-versions@example.com');
      const documentId = await createDocument(token);
      const save = () =>
        request(app.getHttpServer())
          .post(`/documents/${documentId}/versions`)
          .set(auth(token))
          .send({});
      await save().expect(201);
      await save().expect(201);
      const res = await save().expect(409);
      expect(res.body.message).toBe('Version limit reached (2)');
    });

    it('caps templates per non-admin user; admins are exempt', async () => {
      const token = await registerAndLogin('limits-templates@example.com');
      await postTemplate(token).expect(201);
      await postTemplate(token).expect(201);
      const res = await postTemplate(token).expect(409);
      expect(res.body.message).toBe('Template limit reached (2)');

      const adminEmail = 'limits-templates-admin@example.com';
      const adminToken = await registerAndLogin(adminEmail);
      await promoteToAdmin(pg.env, adminEmail);
      for (let i = 0; i < 4; i += 1) {
        await postTemplate(adminToken).expect(201);
      }
    });

    it('is race-safe: parallel template creates never overshoot the cap', async () => {
      const token = await registerAndLogin('limits-tpl-race@example.com');
      const results = await Promise.all(
        Array.from({ length: 6 }, () => postTemplate(token)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    });
  });
});
