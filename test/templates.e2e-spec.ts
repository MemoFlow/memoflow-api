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
describeWithDocker()('Templates (e2e)', () => {
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

  function templatePayload(
    overrides: Partial<{
      title: string;
      docType: string;
      scope: string;
      isPublished: boolean;
    }> = {},
  ) {
    return {
      title: overrides.title ?? 'Standard Blog Post',
      docType: overrides.docType ?? 'blog',
      scope: overrides.scope ?? 'personal',
      isPublished: overrides.isPublished ?? false,
      sections: [
        { title: 'Intro', order: 0, wordCountMin: 20, wordCountMax: 100 },
        {
          title: 'Body',
          order: 1,
          wordCountMin: 100,
          wordCountMax: 500,
          isRequired: true,
        },
      ],
    };
  }

  async function createTemplate(
    token: string,
    overrides: Partial<{
      title: string;
      docType: string;
      scope: string;
      isPublished: boolean;
    }> = {},
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${token}`)
      .send(templatePayload(overrides))
      .expect(201);
    return res.body.id as string;
  }

  async function createDocument(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Q3 Planning', docType: 'blog' })
      .expect(201);
    return res.body.id as string;
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

  it('POST /templates requires a token (401 without one)', async () => {
    await request(app.getHttpServer())
      .post('/templates')
      .send(templatePayload())
      .expect(401);
  });

  it('POST /templates creates a template with its sections, defaulting isPublished to false', async () => {
    const token = await registerAndLogin('template-creator@example.com');

    const res = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Standard Blog Post',
        docType: 'blog',
        scope: 'personal',
        sections: [
          { title: 'Intro', order: 0, wordCountMin: 20, wordCountMax: 100 },
        ],
      })
      .expect(201);

    expect(res.body).toMatchObject({
      title: 'Standard Blog Post',
      doc_type: 'blog',
      scope: 'personal',
      created_by: expect.any(String),
      is_published: false,
    });
    expect(res.body.sections).toEqual([
      expect.objectContaining({
        title: 'Intro',
        order: 0,
        word_count_min: 20,
        word_count_max: 100,
        is_required: false,
      }),
    ]);
  });

  it('POST /templates returns 400 when sections is missing', async () => {
    const token = await registerAndLogin('template-invalid@example.com');

    await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'No Sections', docType: 'blog', scope: 'personal' })
      .expect(400);
  });

  it('POST /templates returns 400 when a section has wordCountMin greater than wordCountMax', async () => {
    const token = await registerAndLogin('template-inverted-range@example.com');

    await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Inverted Range',
        docType: 'blog',
        scope: 'personal',
        sections: [
          { title: 'Intro', order: 0, wordCountMin: 100, wordCountMax: 20 },
        ],
      })
      .expect(400);
  });

  it("GET /templates lists published templates and the current user's own unpublished templates, but not another user's unpublished templates", async () => {
    const token = await registerAndLogin('template-lister@example.com');
    const otherToken = await registerAndLogin(
      'template-lister-other@example.com',
    );

    await createTemplate(token, { title: 'Mine (unpublished)' });
    await createTemplate(otherToken, {
      title: 'Published by other',
      isPublished: true,
    });
    await createTemplate(otherToken, { title: "Other's private" });

    const res = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const titles = res.body.map((t: { title: string }) => t.title).sort();
    expect(titles).toEqual(['Mine (unpublished)', 'Published by other']);
  });

  it('GET /templates filters by docType and scope', async () => {
    const token = await registerAndLogin('template-filter@example.com');
    // docType values unique to this test: published templates created by other
    // tests are visible to every user, so a shared docType (e.g. the helper's
    // default 'blog') would leak them into this filtered listing.
    await createTemplate(token, {
      title: 'Blog Template',
      docType: 'filter-blog',
      scope: 'personal',
    });
    await createTemplate(token, {
      title: 'Report Template',
      docType: 'filter-report',
      scope: 'org',
    });

    const res = await request(app.getHttpServer())
      .get('/templates')
      .query({ docType: 'filter-blog' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.map((t: { title: string }) => t.title)).toEqual([
      'Blog Template',
    ]);
  });

  it('GET /templates/:id returns an unpublished template to its owner', async () => {
    const token = await registerAndLogin('template-getter@example.com');
    const templateId = await createTemplate(token);

    const res = await request(app.getHttpServer())
      .get(`/templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({ id: templateId });
  });

  it("GET /templates/:id returns 404 for another user's unpublished template", async () => {
    const ownerToken = await registerAndLogin('template-owner@example.com');
    const templateId = await createTemplate(ownerToken);
    const otherToken = await registerAndLogin(
      'template-someone-else@example.com',
    );

    await request(app.getHttpServer())
      .get(`/templates/${templateId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('GET /templates/:id returns a published template to a different user', async () => {
    const ownerToken = await registerAndLogin(
      'template-published-owner@example.com',
    );
    const templateId = await createTemplate(ownerToken, {
      isPublished: true,
    });
    const otherToken = await registerAndLogin(
      'template-published-other@example.com',
    );

    await request(app.getHttpServer())
      .get(`/templates/${templateId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
  });

  it('GET /templates/:id returns 400 for a non-uuid id', async () => {
    const token = await registerAndLogin('template-bad-id@example.com');

    await request(app.getHttpServer())
      .get('/templates/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('PATCH /templates/:id updates a template owned by the current user', async () => {
    const token = await registerAndLogin('template-updater@example.com');
    const templateId = await createTemplate(token);

    const res = await request(app.getHttpServer())
      .patch(`/templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Renamed', isPublished: true })
      .expect(200);

    expect(res.body).toMatchObject({ title: 'Renamed', is_published: true });
  });

  it('PATCH /templates/:id replaces sections wholesale when provided', async () => {
    const token = await registerAndLogin(
      'template-update-sections@example.com',
    );
    const templateId = await createTemplate(token);

    const res = await request(app.getHttpServer())
      .patch(`/templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sections: [
          {
            title: 'Only Section',
            order: 0,
            wordCountMin: 5,
            wordCountMax: 50,
          },
        ],
      })
      .expect(200);

    expect(res.body.sections).toHaveLength(1);
    expect(res.body.sections[0]).toMatchObject({ title: 'Only Section' });
  });

  it("PATCH /templates/:id returns 404 for another user's template", async () => {
    const ownerToken = await registerAndLogin(
      'template-update-owner@example.com',
    );
    const templateId = await createTemplate(ownerToken);
    const otherToken = await registerAndLogin(
      'template-update-other@example.com',
    );

    await request(app.getHttpServer())
      .patch(`/templates/${templateId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Hijacked' })
      .expect(404);
  });

  it('DELETE /templates/:id deletes a template owned by the current user', async () => {
    const token = await registerAndLogin('template-deleter@example.com');
    const templateId = await createTemplate(token);

    await request(app.getHttpServer())
      .delete(`/templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("DELETE /templates/:id returns 404 (and does not delete) for another user's template", async () => {
    const ownerToken = await registerAndLogin(
      'template-delete-owner@example.com',
    );
    const templateId = await createTemplate(ownerToken);
    const otherToken = await registerAndLogin(
      'template-delete-other@example.com',
    );

    await request(app.getHttpServer())
      .delete(`/templates/${templateId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/templates/${templateId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it("POST /templates/:id/apply appends one section per template section, in order, after the document's existing sections, and records a document_templates row", async () => {
    const token = await registerAndLogin('template-applier@example.com');
    const templateId = await createTemplate(token);
    const documentId = await createDocument(token);

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Existing', content: 'already here' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/templates/${templateId}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentId })
      .expect(201);

    expect(res.body).toMatchObject({
      document_id: documentId,
      template_id: templateId,
      sections_created: 2,
    });
    expect(res.body.document_template_id).toEqual(expect.any(String));
    expect(res.body.applied_at).toEqual(expect.any(String));

    const sectionsRes = await request(app.getHttpServer())
      .get(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(sectionsRes.body.map((s: { title: string }) => s.title)).toEqual([
      'Existing',
      'Intro',
      'Body',
    ]);
    expect(sectionsRes.body.map((s: { order: number }) => s.order)).toEqual([
      0, 1, 2,
    ]);
    expect(
      sectionsRes.body
        .slice(1)
        .every(
          (s: { content: string; word_count: number; status: string }) =>
            s.content === '' && s.word_count === 0 && s.status === 'draft',
        ),
    ).toBe(true);
  });

  it('POST /templates/:id/apply returns 404 for a template that is not visible to the user', async () => {
    const ownerToken = await registerAndLogin(
      'template-apply-owner@example.com',
    );
    const templateId = await createTemplate(ownerToken);
    const otherToken = await registerAndLogin(
      'template-apply-other@example.com',
    );
    const documentId = await createDocument(otherToken);

    await request(app.getHttpServer())
      .post(`/templates/${templateId}/apply`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ documentId })
      .expect(404);
  });

  it('POST /templates/:id/apply returns 404 for a document not owned by the user', async () => {
    const token = await registerAndLogin(
      'template-apply-doc-owner@example.com',
    );
    const templateId = await createTemplate(token, { isPublished: true });
    const otherToken = await registerAndLogin(
      'template-apply-doc-other@example.com',
    );
    const documentId = await createDocument(otherToken);

    await request(app.getHttpServer())
      .post(`/templates/${templateId}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentId })
      .expect(404);
  });
});
