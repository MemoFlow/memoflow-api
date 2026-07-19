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
// MongoDB (document_versions) comes from mongodb-memory-server.
describeWithDocker()('Document versions (e2e)', () => {
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
        content: overrides.content ?? 'Hello world',
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

  it('POST /documents/:documentId/versions requires a token (401 without one)', async () => {
    await request(app.getHttpServer())
      .post('/documents/00000000-0000-0000-0000-000000000000/versions')
      .send({})
      .expect(401);
  });

  it('POST saves a version snapshotting the current sections, defaulting label to null', async () => {
    const token = await registerAndLogin('version-saver@example.com');
    const documentId = await createDocument(token);
    await createSection(token, documentId, {
      title: 'Intro',
      content: 'Hello world',
    });

    const res = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    expect(res.body).toMatchObject({
      document_id: documentId,
      version: 1,
      label: null,
    });
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.sections_snapshot).toEqual([
      expect.objectContaining({
        title: 'Intro',
        content: 'Hello world',
        order: 0,
        status: 'draft',
        word_count: 2,
      }),
    ]);
  });

  it('POST saves a version with an empty snapshot when the document has no sections', async () => {
    const token = await registerAndLogin('version-empty@example.com');
    const documentId = await createDocument(token);

    const res = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Empty start' })
      .expect(201);

    expect(res.body.sections_snapshot).toEqual([]);
    expect(res.body.label).toBe('Empty start');
  });

  it('POST returns 400 when label exceeds the max length', async () => {
    const token = await registerAndLogin('version-label-too-long@example.com');
    const documentId = await createDocument(token);

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'x'.repeat(201) })
      .expect(400);
  });

  it('POST returns 404 for a document not owned by the caller', async () => {
    const ownerToken = await registerAndLogin('version-owner@example.com');
    const documentId = await createDocument(ownerToken);
    const otherToken = await registerAndLogin('version-other@example.com');

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({})
      .expect(404);
  });

  it('numbers versions sequentially across multiple saves for the same document', async () => {
    const token = await registerAndLogin('version-numbering@example.com');
    const documentId = await createDocument(token);

    const first = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'First' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Second' })
      .expect(201);
    const third = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Third' })
      .expect(201);

    expect(first.body.version).toBe(1);
    expect(second.body.version).toBe(2);
    expect(third.body.version).toBe(3);
  });

  it('GET / lists version metadata newest first, without the sections payload', async () => {
    const token = await registerAndLogin('version-lister@example.com');
    const documentId = await createDocument(token);
    await createSection(token, documentId);

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'v1' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'v2' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body.map((v: { label: string }) => v.label)).toEqual([
      'v2',
      'v1',
    ]);
    expect(res.body[0]).toMatchObject({
      document_id: documentId,
      version: 2,
      section_count: 1,
    });
    expect(res.body[0]).not.toHaveProperty('sections_snapshot');
  });

  it('GET / returns 404 for a document not owned by the caller', async () => {
    const ownerToken = await registerAndLogin('version-list-owner@example.com');
    const documentId = await createDocument(ownerToken);
    const otherToken = await registerAndLogin('version-list-other@example.com');

    await request(app.getHttpServer())
      .get(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('GET /:versionId returns the full snapshot', async () => {
    const token = await registerAndLogin('version-getter@example.com');
    const documentId = await createDocument(token);
    await createSection(token, documentId, {
      title: 'Intro',
      content: 'Once upon a time',
    });

    const saveRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Snapshot' })
      .expect(201);
    const versionId = saveRes.body.id as string;

    const res = await request(app.getHttpServer())
      .get(`/documents/${documentId}/versions/${versionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({ id: versionId, label: 'Snapshot' });
    expect(res.body.sections_snapshot).toEqual([
      expect.objectContaining({ title: 'Intro', content: 'Once upon a time' }),
    ]);
  });

  it('GET /:versionId returns 400 for a malformed (non-ObjectId) versionId', async () => {
    const token = await registerAndLogin('version-bad-id@example.com');
    const documentId = await createDocument(token);

    await request(app.getHttpServer())
      .get(`/documents/${documentId}/versions/not-an-object-id`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /:versionId returns 404 for a well-formed but non-existent versionId', async () => {
    const token = await registerAndLogin('version-missing@example.com');
    const documentId = await createDocument(token);

    await request(app.getHttpServer())
      .get(`/documents/${documentId}/versions/000000000000000000000000`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("GET /:versionId returns 404 for another user's document", async () => {
    const ownerToken = await registerAndLogin('version-get-owner@example.com');
    const documentId = await createDocument(ownerToken);
    const saveRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    const versionId = saveRes.body.id as string;
    const otherToken = await registerAndLogin('version-get-other@example.com');

    await request(app.getHttpServer())
      .get(`/documents/${documentId}/versions/${versionId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('GET /:versionId returns 404 when the version belongs to a different document', async () => {
    const token = await registerAndLogin('version-cross-doc@example.com');
    const documentIdA = await createDocument(token);
    const documentIdB = await createDocument(token);
    const saveRes = await request(app.getHttpServer())
      .post(`/documents/${documentIdA}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    const versionId = saveRes.body.id as string;

    await request(app.getHttpServer())
      .get(`/documents/${documentIdB}/versions/${versionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("POST /:versionId/restore replaces the document's current sections with the snapshot", async () => {
    const token = await registerAndLogin('version-restorer@example.com');
    const documentId = await createDocument(token);
    await createSection(token, documentId, {
      title: 'Original Intro',
      content: 'Original content',
    });

    const saveRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Before rewrite' })
      .expect(201);
    const versionId = saveRes.body.id as string;

    // Mutate the document's sections after the snapshot: add a new one and
    // remove the original, so restore has something real to undo.
    await createSection(token, documentId, {
      title: 'New Section',
      content: 'New content',
    });
    const currentSections = await request(app.getHttpServer())
      .get(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const originalSectionId = currentSections.body.find(
      (s: { title: string }) => s.title === 'Original Intro',
    ).id as string;
    await request(app.getHttpServer())
      .delete(`/documents/${documentId}/sections/${originalSectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const restoreRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions/${versionId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(restoreRes.body).toEqual({
      document_id: documentId,
      version_id: versionId,
      version: 1,
      sections_restored: 1,
    });

    const restoredSections = await request(app.getHttpServer())
      .get(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(restoredSections.body).toHaveLength(1);
    expect(restoredSections.body[0]).toMatchObject({
      title: 'Original Intro',
      content: 'Original content',
    });

    // Restoring must not create a new Mongo version.
    const versionsAfterRestore = await request(app.getHttpServer())
      .get(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(versionsAfterRestore.body).toHaveLength(1);
  });

  it('POST /:versionId/restore returns 404 for a version belonging to another document', async () => {
    const token = await registerAndLogin(
      'version-restore-cross-doc@example.com',
    );
    const documentIdA = await createDocument(token);
    const documentIdB = await createDocument(token);
    const saveRes = await request(app.getHttpServer())
      .post(`/documents/${documentIdA}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    const versionId = saveRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/documents/${documentIdB}/versions/${versionId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("POST /:versionId/restore returns 404 for another user's document", async () => {
    const ownerToken = await registerAndLogin(
      'version-restore-owner@example.com',
    );
    const documentId = await createDocument(ownerToken);
    const saveRes = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    const versionId = saveRes.body.id as string;
    const otherToken = await registerAndLogin(
      'version-restore-other@example.com',
    );

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions/${versionId}/restore`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });
});
