import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import type {
  LlmCompletion,
  LlmCompletionRequest,
} from './../src/domain/ai/llm-gateway.port';
import type { PlanningJobRepository } from './../src/domain/context/planning-job.repository';
import type { ProcessPlanningJobUseCase } from './../src/application/context/process-planning-job.use-case';
import { AI_NOTICE_VERSION } from './../src/domain/ai/ai-consent';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';
import { promoteToAdmin } from './utils/promote-admin';
import { startRedisContainer, RedisTestEnv } from './utils/redis-testcontainer';
import { registerUser } from './utils/register-user';
import { stopContainer } from './utils/stop-container';

const CONSENT_MESSAGE =
  'AI consent is required. Accept the current AI notice to use AI features.';

class ScriptedGateway {
  requests: LlmCompletionRequest[] = [];

  modelIdentity(): string {
    return 'fake/model-1';
  }

  isAvailable(): boolean {
    return true;
  }

  complete(req: LlmCompletionRequest): Promise<LlmCompletion> {
    this.requests.push(req);
    return Promise.resolve({
      json:
        req.jsonSchema.name === 'planning_result'
          ? { suggestions: ['A step'], outline: null, sources: [] }
          : { suggested_text: 'A polished version.' },
      model: 'scripted/model',
      finishReason: 'stop',
    });
  }
}

class ScriptedGatherer {
  gather(): Promise<Record<string, unknown>> {
    return Promise.resolve({ chunks: [] });
  }
}

interface Account {
  token: string;
  userId: string;
  email: string;
}

describeWithDocker()('AI consent (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;
  let jobRepository: PlanningJobRepository;
  let processJob: ProcessPlanningJobUseCase;
  const gateway = new ScriptedGateway();
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (a: Account) => ({ Authorization: `Bearer ${a.token}` });

  async function sql<T extends object>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = new Client({
      host: pg.env.POSTGRES_HOST,
      port: Number(pg.env.POSTGRES_PORT),
      user: pg.env.POSTGRES_USER,
      password: pg.env.POSTGRES_PASSWORD,
      database: pg.env.POSTGRES_DB,
    });
    await client.connect();
    try {
      const res = await client.query(text, params);
      return res.rows as T[];
    } finally {
      await client.end();
    }
  }

  /** A fresh account that has NOT consented. */
  async function newAccount(label: string): Promise<Account> {
    seq += 1;
    const payload = {
      email: `${label}-${seq}@example.com`,
      password: 'correct-horse-battery-staple',
      display_name: 'Test User',
    };
    await registerUser(app, payload);
    const login = await http()
      .post('/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);
    const token = login.body.accessToken as string;
    const me = await http()
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return { token, userId: me.body.id as string, email: payload.email };
  }

  const accept = (a: Account, version: string = AI_NOTICE_VERSION) =>
    http().post('/users/me/ai-consent').set(auth(a)).send({ version });

  async function newSection(a: Account): Promise<string> {
    const doc = await http()
      .post('/documents')
      .set(auth(a))
      .send({ title: 'Consent', docType: 'blog' })
      .expect(201);
    const res = await http()
      .post(`/documents/${doc.body.id as string}/sections`)
      .set(auth(a))
      .send({ title: 'Intro', content: 'Some text to improve.' })
      .expect(201);
    return res.body.id as string;
  }

  const suggest = (a: Account, sectionId: string) =>
    http()
      .post(`/sections/${sectionId}/suggestions`)
      .set(auth(a))
      .send({ featureType: 'suggestion' });

  const plan = (a: Account) =>
    http().post('/planning-jobs').set(auth(a)).send({ prompt: 'Plan it' });

  async function auditActions(userId: string): Promise<string[]> {
    const deadline = Date.now() + 5_000;
    let rows: { action: string; metadata: unknown }[] = [];
    while (Date.now() < deadline) {
      rows = await sql(
        `SELECT action, metadata FROM audit_logs WHERE user_id = $1 AND action LIKE 'ai.%' ORDER BY created_at`,
        [userId],
      );
      if (rows.length >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return rows.map((r) => r.action);
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
      OPENROUTER_API_KEY: 'e2e-not-a-real-key',
      AI_USER_DAILY_LIMIT: '100000',
      AI_GLOBAL_DAILY_LIMIT: '100000',
      AI_CACHE_TTL_SECONDS: '60',
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
    const { HttpExceptionFilter } =
      await import('./../src/shared/filters/http-exception.filter');
    const { LLM_GATEWAY } = await import('./../src/domain/ai/llm-gateway.port');
    const { CONTEXT_GATHERER } =
      await import('./../src/domain/context/context-gatherer.port');
    const { PLANNING_JOB_REPOSITORY } =
      await import('./../src/domain/context/planning-job.repository');
    const { ProcessPlanningJobUseCase: ProcessJob } =
      await import('./../src/application/context/process-planning-job.use-case');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LLM_GATEWAY)
      .useValue(gateway)
      .overrideProvider(CONTEXT_GATHERER)
      .useValue(new ScriptedGatherer())
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    jobRepository = app.get<PlanningJobRepository>(PLANNING_JOB_REPOSITORY);
    processJob = app.get(ProcessJob);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await stopContainer(pg?.container);
    await mongo?.server.stop();
    await stopContainer(redis?.container);
  });

  beforeEach(() => {
    gateway.requests = [];
  });

  it('answers 403 AI_CONSENT_REQUIRED on both AI routes without consent, with no provider call', async () => {
    const a = await newAccount('no-consent');
    const sectionId = await newSection(a);

    const s = await suggest(a, sectionId).expect(403);
    const p = await plan(a).expect(403);

    for (const res of [s, p]) {
      expect(res.body).toMatchObject({
        statusCode: 403,
        message: CONSENT_MESSAGE,
        error: 'AI_CONSENT_REQUIRED',
      });
      expect(typeof res.body.path).toBe('string');
      expect(typeof res.body.timestamp).toBe('string');
    }
    expect(gateway.requests).toHaveLength(0);
  });

  it('shows ai_consent on /users/me and lets accept, use and withdraw round trip', async () => {
    const a = await newAccount('round-trip');
    const sectionId = await newSection(a);

    const before = await http().get('/users/me').set(auth(a)).expect(200);
    expect(before.body.ai_consent).toEqual({
      accepted_at: null,
      version: null,
      current_version: AI_NOTICE_VERSION,
      required: true,
    });

    const accepted = await accept(a).expect(200);
    expect(accepted.body.ai_consent).toMatchObject({
      version: AI_NOTICE_VERSION,
      current_version: AI_NOTICE_VERSION,
      required: false,
    });
    expect(accepted.body.ai_consent.accepted_at).toEqual(expect.any(String));
    expect(accepted.body).not.toHaveProperty('password_hash');

    await suggest(a, sectionId).expect(201);
    expect(gateway.requests).toHaveLength(1);
    await plan(a).expect(202);

    await http().delete('/users/me/ai-consent').set(auth(a)).expect(204);
    // Idempotent.
    await http().delete('/users/me/ai-consent').set(auth(a)).expect(204);

    const after = await http().get('/users/me').set(auth(a)).expect(200);
    expect(after.body.ai_consent).toMatchObject({
      accepted_at: null,
      version: null,
      required: true,
    });
    const calls = gateway.requests.length;
    await suggest(a, sectionId).expect(403);
    await plan(a).expect(403);
    expect(gateway.requests).toHaveLength(calls);
  });

  it('answers 409 for a version other than the current one and records nothing', async () => {
    const a = await newAccount('wrong-version');

    const res = await accept(a, '1999-01-01').expect(409);

    expect(res.body.message).toBe(
      'The AI notice version is not current. Reload the notice and accept again.',
    );
    const me = await http().get('/users/me').set(auth(a)).expect(200);
    expect(me.body.ai_consent.required).toBe(true);
    await http().post('/users/me/ai-consent').set(auth(a)).send({}).expect(400);
  });

  it('refreshes the timestamp when accepting again', async () => {
    const a = await newAccount('re-accept');
    const first = await accept(a).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await accept(a).expect(200);
    expect(
      Date.parse(second.body.ai_consent.accepted_at as string),
    ).toBeGreaterThan(Date.parse(first.body.ai_consent.accepted_at as string));
  });

  it('answers 403 for a stale stored version, shown as required', async () => {
    const a = await newAccount('stale');
    const sectionId = await newSection(a);
    await accept(a).expect(200);
    await sql(
      `UPDATE users SET ai_consent_version = '2020-01-01' WHERE id = $1`,
      [a.userId],
    );

    const me = await http().get('/users/me').set(auth(a)).expect(200);
    expect(me.body.ai_consent).toMatchObject({
      version: '2020-01-01',
      required: true,
    });
    const res = await suggest(a, sectionId).expect(403);
    expect(res.body.error).toBe('AI_CONSENT_REQUIRED');
    await plan(a).expect(403);
  });

  it('keeps read routes open after withdrawal, and serves no cached suggestion through the create route', async () => {
    const a = await newAccount('after-withdraw');
    const sectionId = await newSection(a);
    await accept(a).expect(200);
    const created = await suggest(a, sectionId).expect(201);
    const job = await plan(a).expect(202);
    // Same content again would hit the response cache.
    await suggest(a, sectionId).expect(201);
    await http().delete('/users/me/ai-consent').set(auth(a)).expect(204);

    await suggest(a, sectionId).expect(403);
    const list = await http()
      .get(`/sections/${sectionId}/suggestions`)
      .set(auth(a))
      .expect(200);
    expect(list.body.map((s: { id: string }) => s.id)).toContain(
      created.body.id,
    );
    await http()
      .get(`/planning-jobs/${job.body.job_id as string}`)
      .set(auth(a))
      .expect(200);
  });

  it('requires consent from admins too', async () => {
    const admin = await newAccount('admin');
    await promoteToAdmin(pg.env, admin.email);
    const sectionId = await newSection(admin);

    const res = await suggest(admin, sectionId).expect(403);
    expect(res.body.error).toBe('AI_CONSENT_REQUIRED');
    await accept(admin).expect(200);
    await suggest(admin, sectionId).expect(201);
  });

  it('fails a queued job with AI_CONSENT_REQUIRED and no provider call when consent is withdrawn before the worker runs', async () => {
    const a = await newAccount('queued');
    await accept(a).expect(200);
    const job = await jobRepository.create({
      userId: a.userId,
      prompt: 'Plan after withdrawal',
      connectors: [],
      documentId: null,
      sectionId: null,
    });
    await http().delete('/users/me/ai-consent').set(auth(a)).expect(204);

    const { processed, job: done } = await processJob.execute({
      jobId: job.id,
    });

    expect(processed).toBe(true);
    expect(done.status).toBe('failed');
    expect(done.errorCode).toBe('AI_CONSENT_REQUIRED');
    expect(done.errorMessage).toBe(CONSENT_MESSAGE);
    expect(gateway.requests).toHaveLength(0);
  });

  it('hides ai_consent from another viewer, an admin included', async () => {
    const owner = await newAccount('owner');
    await accept(owner).expect(200);
    const other = await newAccount('other');
    const admin = await newAccount('viewer-admin');
    await promoteToAdmin(pg.env, admin.email);

    const self = await http()
      .get(`/users/${owner.userId}`)
      .set(auth(owner))
      .expect(200);
    expect(self.body.ai_consent.required).toBe(false);
    const byAdmin = await http()
      .get(`/users/${owner.userId}`)
      .set(auth(admin))
      .expect(200);
    expect(byAdmin.body).not.toHaveProperty('ai_consent');
    await http().get(`/users/${owner.userId}`).set(auth(other)).expect(404);
  });

  it('requires a token on both consent routes', async () => {
    await http()
      .post('/users/me/ai-consent')
      .send({ version: AI_NOTICE_VERSION })
      .expect(401);
    await http().delete('/users/me/ai-consent').expect(401);
  });

  it('writes audit rows for accept and withdraw', async () => {
    const a = await newAccount('audit');
    await accept(a).expect(200);
    await http().delete('/users/me/ai-consent').set(auth(a)).expect(204);
    await accept(a).expect(200);

    const actions = await auditActions(a.userId);
    expect(actions).toEqual([
      'ai.consent_accepted',
      'ai.consent_withdrawn',
      'ai.consent_accepted',
    ]);
    const rows = await sql<{ metadata: { version?: string } | null }>(
      `SELECT metadata FROM audit_logs WHERE user_id = $1 AND action = 'ai.consent_accepted'`,
      [a.userId],
    );
    expect(rows.every((r) => r.metadata?.version === AI_NOTICE_VERSION)).toBe(
      true,
    );
  });
});
