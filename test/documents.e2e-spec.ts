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

// Booting AppModule requires a live PostgreSQL (TypeORM connects at init),
// which Testcontainers can only provide when a Docker daemon is present.
describeWithDocker()('Documents + Sections (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;

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

  async function createDocument(
    token: string,
    overrides: Partial<{ title: string; docType: string }> = {},
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: overrides.title ?? 'Q3 Planning',
        docType: overrides.docType ?? 'planning',
      })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    Object.assign(process.env, pg.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
      COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  });

  it('POST /documents requires a token (401 without one)', async () => {
    await request(app.getHttpServer())
      .post('/documents')
      .send({ title: 'Untitled', docType: 'planning' })
      .expect(401);
  });

  it('POST /documents creates a document defaulting status to draft and styleConfig to {}', async () => {
    const token = await registerAndLogin('doc-creator@example.com');

    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Q3 Planning', docType: 'planning' })
      .expect(201);

    expect(res.body).toMatchObject({
      title: 'Q3 Planning',
      doc_type: 'planning',
      status: 'draft',
      style_config: {},
    });
    expect(res.body.id).toEqual(expect.any(String));
  });

  it("GET /documents lists only the current user's documents", async () => {
    const token = await registerAndLogin('doc-lister@example.com');
    const otherToken = await registerAndLogin('doc-lister-other@example.com');

    await createDocument(token, { title: 'Mine' });
    await createDocument(otherToken, { title: 'Not mine' });

    const res = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ title: 'Mine' });
  });

  it('GET /documents/:id returns the document when owned by the current user', async () => {
    const token = await registerAndLogin('doc-getter@example.com');
    const documentId = await createDocument(token);

    const res = await request(app.getHttpServer())
      .get(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({ id: documentId, title: 'Q3 Planning' });
  });

  it('GET /documents/:id returns 400 for a non-uuid id', async () => {
    const token = await registerAndLogin('doc-bad-id@example.com');

    await request(app.getHttpServer())
      .get('/documents/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /documents/:id returns 404 for an unknown (but valid) uuid', async () => {
    const token = await registerAndLogin('doc-unknown-id@example.com');

    await request(app.getHttpServer())
      .get('/documents/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("GET /documents/:id returns 404 (not another user's data) for someone else's document", async () => {
    const ownerToken = await registerAndLogin('doc-owner@example.com');
    const documentId = await createDocument(ownerToken);

    const otherToken = await registerAndLogin('doc-someone-else@example.com');

    await request(app.getHttpServer())
      .get(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('PATCH /documents/:id updates the document when owned by the current user', async () => {
    const token = await registerAndLogin('doc-updater@example.com');
    const documentId = await createDocument(token);

    const res = await request(app.getHttpServer())
      .patch(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Renamed', status: 'published' })
      .expect(200);

    expect(res.body).toMatchObject({ title: 'Renamed', status: 'published' });
  });

  it("PATCH /documents/:id returns 404 for another user's document", async () => {
    const ownerToken = await registerAndLogin('doc-update-owner@example.com');
    const documentId = await createDocument(ownerToken);
    const otherToken = await registerAndLogin('doc-update-other@example.com');

    await request(app.getHttpServer())
      .patch(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Hijacked' })
      .expect(404);
  });

  it('DELETE /documents/:id deletes the document (owner-scoped) and cascades its sections', async () => {
    const token = await registerAndLogin('doc-deleter@example.com');
    const documentId = await createDocument(token);
    await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Intro', content: 'hello world' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("DELETE /documents/:id returns 404 (and does not delete) for another user's document", async () => {
    const ownerToken = await registerAndLogin('doc-delete-owner@example.com');
    const documentId = await createDocument(ownerToken);
    const otherToken = await registerAndLogin('doc-delete-other@example.com');

    await request(app.getHttpServer())
      .delete(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('POST /documents/:documentId/sections creates a section and computes word_count server-side', async () => {
    const token = await registerAndLogin('section-creator@example.com');
    const documentId = await createDocument(token);

    const res = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Intro', content: 'one two three four' })
      .expect(201);

    expect(res.body).toMatchObject({
      title: 'Intro',
      content: 'one two three four',
      word_count: 4,
      order: 0,
      status: 'draft',
    });
  });

  it('POST /documents/:documentId/sections ignores a client-supplied order and always appends', async () => {
    const token = await registerAndLogin('section-no-client-order@example.com');
    const documentId = await createDocument(token);

    const res = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      // `order` is not part of CreateSectionDto — whitelist:true strips it,
      // so this must still land at 0 (append), not the requested 5.
      .send({ title: 'Intro', content: 'a', order: 5 })
      .expect(201);

    expect(res.body.order).toBe(0);
  });

  it('POST /documents/:documentId/sections appends after the last section when order is omitted', async () => {
    const token = await registerAndLogin('section-append@example.com');
    const documentId = await createDocument(token);

    const first = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'First', content: 'a' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Second', content: 'b' })
      .expect(201);

    expect(first.body.order).toBe(0);
    expect(second.body.order).toBe(1);
  });

  it("POST /documents/:documentId/sections returns 404 for another user's document", async () => {
    const ownerToken = await registerAndLogin('section-owner@example.com');
    const documentId = await createDocument(ownerToken);
    const otherToken = await registerAndLogin('section-other@example.com');

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Intro', content: 'hi' })
      .expect(404);
  });

  it("GET /documents/:documentId/sections lists sections ordered by 'order'", async () => {
    const token = await registerAndLogin('section-lister@example.com');
    const documentId = await createDocument(token);

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'First', content: 'a' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Second', content: 'b' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.map((s: { title: string }) => s.title)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('GET /documents/:documentId/sections/:id returns the section (owner-scoped)', async () => {
    const token = await registerAndLogin('section-getter@example.com');
    const documentId = await createDocument(token);
    const createRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Intro', content: 'hi there' })
      .expect(201);
    const sectionId = createRes.body.id as string;

    const res = await request(app.getHttpServer())
      .get(`/documents/${documentId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({ id: sectionId, title: 'Intro' });
  });

  it("GET /documents/:documentId/sections/:id returns 404 (not another user's data) for someone else's section", async () => {
    const ownerToken = await registerAndLogin('section-get-owner@example.com');
    const documentId = await createDocument(ownerToken);
    const createRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Intro', content: 'hi there' })
      .expect(201);
    const sectionId = createRes.body.id as string;

    const otherToken = await registerAndLogin('section-get-other@example.com');

    await request(app.getHttpServer())
      .get(`/documents/${documentId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('PATCH /documents/:documentId/sections/:id recomputes word_count when content changes', async () => {
    const token = await registerAndLogin('section-updater@example.com');
    const documentId = await createDocument(token);
    const createRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Intro', content: 'one two' })
      .expect(201);
    const sectionId = createRes.body.id as string;

    const res = await request(app.getHttpServer())
      .patch(`/documents/${documentId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'one two three four five' })
      .expect(200);

    expect(res.body.word_count).toBe(5);
  });

  it('PATCH /documents/:documentId/sections/:id ignores a client-supplied order', async () => {
    const token = await registerAndLogin('section-update-no-order@example.com');
    const documentId = await createDocument(token);
    const createRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Intro', content: 'one two' })
      .expect(201);
    const sectionId = createRes.body.id as string;

    const res = await request(app.getHttpServer())
      .patch(`/documents/${documentId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      // `order` is not part of UpdateSectionDto — whitelist:true strips it;
      // position only ever changes via PATCH .../sections/reorder.
      .send({ title: 'Renamed', order: 5 })
      .expect(200);

    expect(res.body.order).toBe(0);
  });

  it('DELETE /documents/:documentId/sections/:id deletes the section (owner-scoped)', async () => {
    const token = await registerAndLogin('section-deleter@example.com');
    const documentId = await createDocument(token);
    const createRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Intro', content: 'hi there' })
      .expect(201);
    const sectionId = createRes.body.id as string;

    await request(app.getHttpServer())
      .delete(`/documents/${documentId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/documents/${documentId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("DELETE /documents/:documentId/sections/:id returns 404 (and does not delete) for another user's section", async () => {
    const ownerToken = await registerAndLogin(
      'section-delete-owner@example.com',
    );
    const documentId = await createDocument(ownerToken);
    const createRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Intro', content: 'hi there' })
      .expect(201);
    const sectionId = createRes.body.id as string;
    const otherToken = await registerAndLogin(
      'section-delete-other@example.com',
    );

    await request(app.getHttpServer())
      .delete(`/documents/${documentId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/documents/${documentId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('PATCH /documents/:documentId/sections/reorder reorders the sections and returns them in the new order', async () => {
    const token = await registerAndLogin('section-reorderer@example.com');
    const documentId = await createDocument(token);
    const first = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'First', content: 'a' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Second', content: 'b' })
      .expect(201);
    const third = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Third', content: 'c' })
      .expect(201);

    const newOrder = [third.body.id, first.body.id, second.body.id] as string[];

    const res = await request(app.getHttpServer())
      .patch(`/documents/${documentId}/sections/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sectionIds: newOrder })
      .expect(200);

    expect(res.body.map((s: { id: string }) => s.id)).toEqual(newOrder);
    expect(res.body.map((s: { order: number }) => s.order)).toEqual([0, 1, 2]);

    const listRes = await request(app.getHttpServer())
      .get(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.map((s: { id: string }) => s.id)).toEqual(newOrder);
  });

  it("PATCH /documents/:documentId/sections/reorder returns 400 when sectionIds does not match the document's sections", async () => {
    const token = await registerAndLogin('section-reorder-bad@example.com');
    const documentId = await createDocument(token);
    await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'First', content: 'a' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Second', content: 'b' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/documents/${documentId}/sections/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sectionIds: ['00000000-0000-0000-0000-000000000000'] })
      .expect(400);
  });

  it("PATCH /documents/:documentId/sections/reorder returns 404 for another user's document", async () => {
    const ownerToken = await registerAndLogin(
      'section-reorder-owner@example.com',
    );
    const documentId = await createDocument(ownerToken);
    const createRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'First', content: 'a' })
      .expect(201);
    const otherToken = await registerAndLogin(
      'section-reorder-other@example.com',
    );

    await request(app.getHttpServer())
      .patch(`/documents/${documentId}/sections/reorder`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ sectionIds: [createRes.body.id] })
      .expect(404);
  });

  it('returns 404 for GET/PATCH/DELETE on a section addressed through a sibling document the same user owns (cross-document IDOR)', async () => {
    const token = await registerAndLogin('cross-document-idor@example.com');
    const documentA = await createDocument(token, { title: 'Document A' });
    const documentB = await createDocument(token, { title: 'Document B' });

    const createRes = await request(app.getHttpServer())
      .post(`/documents/${documentA}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Belongs to A', content: 'hello' })
      .expect(201);
    const sectionId = createRes.body.id as string;

    // The user owns both documents, but the section belongs to A, not B —
    // addressing it through B must 404 rather than leak/allow cross-document
    // access just because the ownership check passed.
    await request(app.getHttpServer())
      .get(`/documents/${documentB}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/documents/${documentB}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Hijacked via sibling document' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/documents/${documentB}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    // The section is untouched and still reachable through its real parent.
    await request(app.getHttpServer())
      .get(`/documents/${documentA}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
