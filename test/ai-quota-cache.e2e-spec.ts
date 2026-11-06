import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Client } from 'pg';
import { Redis } from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import type {
  LlmCompletion,
  LlmCompletionRequest,
} from './../src/domain/ai/llm-gateway.port';
import type { PlanningJobRepository } from './../src/domain/context/planning-job.repository';
import type { HandleContextResultChunkUseCase } from './../src/application/context/handle-context-result-chunk.use-case';
import type { ProcessPlanningJobUseCase } from './../src/application/context/process-planning-job.use-case';
import {
  globalQuotaKey,
  userQuotaKey,
  utcDay,
} from './../src/infrastructure/ai/redis-ai-quota';
import { acceptAiConsent } from './utils/ai-consent';
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

const USER_LIMIT = 10;
const GLOBAL_LIMIT = 40;
const QUOTA_MESSAGE = 'Daily AI usage limit reached. Try again later.';

/**
 * Scripted `LlmGateway`. Like the real one it awaits `beforeAttempt` before
 * every provider attempt (`attemptsPerCall` of them per call, to stand in for
 * retries) and records a request only once those pass, so `requests` counts
 * calls that reached the "provider".
 */
class ScriptedGateway {
  requests: LlmCompletionRequest[] = [];
  attemptsPerCall = 1;
  /** Runs first in every call, e.g. to break Redis mid-job. */
  beforeCall: (() => Promise<void>) | null = null;
  private calls = 0;

  isAvailable(): boolean {
    return true;
  }

  modelIdentity(): string {
    return '["scripted/model"]';
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletion> {
    await this.beforeCall?.();
    for (let i = 0; i < this.attemptsPerCall; i += 1) {
      await req.beforeAttempt();
    }
    this.requests.push(req);
    this.calls += 1;
    const json =
      req.jsonSchema.name === 'planning_result'
        ? { suggestions: ['A step'], outline: null, sources: [] }
        : { suggested_text: `Reply #${this.calls}` };
    return { json, model: 'scripted/model', finishReason: 'stop' };
  }

  reset(): void {
    this.requests = [];
    this.attemptsPerCall = 1;
    this.beforeCall = null;
    this.calls = 0;
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

type RedisClientHolder = { client: Redis };

describeWithDocker()('AI quota and caching (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;
  let redisClient: Redis;
  const gateway = new ScriptedGateway();
  let jobRepository: PlanningJobRepository;
  let chunkHandler: HandleContextResultChunkUseCase;
  let processJob: ProcessPlanningJobUseCase;
  let quotaClient: Redis;
  let cacheClient: Redis;
  let seq = 0;

  const today = () => utcDay(new Date());

  async function sql(text: string, params: unknown[] = []): Promise<void> {
    const client = new Client({
      host: pg.env.POSTGRES_HOST,
      port: Number(pg.env.POSTGRES_PORT),
      user: pg.env.POSTGRES_USER,
      password: pg.env.POSTGRES_PASSWORD,
      database: pg.env.POSTGRES_DB,
    });
    await client.connect();
    try {
      await client.query(text, params);
    } finally {
      await client.end();
    }
  }

  async function newAccount(label: string): Promise<Account> {
    seq += 1;
    const payload = {
      email: `${label}-${seq}@example.com`,
      password: 'correct-horse-battery-staple',
      display_name: 'Test User',
    };
    await registerUser(app, payload);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);
    const token = login.body.accessToken as string;
    await acceptAiConsent(app, token);
    const me = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return { token, userId: me.body.id as string, email: payload.email };
  }

  async function newDocument(account: Account): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ title: `Doc ${seq}`, docType: 'blog' })
      .expect(201);
    return res.body.id as string;
  }

  async function newSection(
    account: Account,
    documentId: string,
    content: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${account.token}`)
      .send({ title: 'Part', content })
      .expect(201);
    return res.body.id as string;
  }

  const suggest = (account: Account, sectionId: string) =>
    request(app.getHttpServer())
      .post(`/sections/${sectionId}/suggestions`)
      .set('Authorization', `Bearer ${account.token}`)
      .send({ featureType: 'suggestion' });

  const submitJob = (account: Account, body: object = {}) =>
    request(app.getHttpServer())
      .post('/planning-jobs')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ prompt: 'Plan my week', ...body });

  async function untilTerminal(
    account: Account,
    jobId: string,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const res = await request(app.getHttpServer())
        .get(`/planning-jobs/${jobId}`)
        .set('Authorization', `Bearer ${account.token}`)
        .expect(200);
      if (res.body.status === 'completed' || res.body.status === 'failed') {
        return res.body as Record<string, unknown>;
      }
      if (Date.now() > deadline) throw new Error('job did not finish');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function counter(key: string): Promise<number> {
    return Number((await redisClient.get(key)) ?? 0);
  }

  const userUsed = (account: Account) =>
    counter(userQuotaKey(account.userId, today()));
  const globalUsed = () => counter(globalQuotaKey(today()));

  /** Forget today's counters and every cached suggestion. */
  async function resetAiKeys(): Promise<void> {
    const keys = [
      ...(await redisClient.keys('ai-quota:*')),
      ...(await redisClient.keys('ai-cache:*')),
    ];
    if (keys.length > 0) await redisClient.del(...keys);
  }

  /** Cuts one adapter's Redis connection, as a Redis outage would. */
  function cut(client: Redis): void {
    client.disconnect();
  }

  async function restore(client: Redis): Promise<void> {
    await client.connect().catch(() => undefined);
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
      // A key makes the factories pick the gateway-backed generator and
      // planner; LLM_GATEWAY itself is replaced below.
      OPENROUTER_API_KEY: 'e2e-not-a-real-key',
      AI_USER_DAILY_LIMIT: String(USER_LIMIT),
      AI_GLOBAL_DAILY_LIMIT: String(GLOBAL_LIMIT),
      AI_CACHE_TTL_SECONDS: '3600',
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
    const { AI_QUOTA } = await import('./../src/domain/ai/ai-quota.port');
    const { AI_RESPONSE_CACHE } =
      await import('./../src/domain/ai/ai-response-cache.port');
    const { CONTEXT_GATHERER } =
      await import('./../src/domain/context/context-gatherer.port');
    const { PLANNING_JOB_REPOSITORY } =
      await import('./../src/domain/context/planning-job.repository');
    const { HandleContextResultChunkUseCase: HandleChunk } =
      await import('./../src/application/context/handle-context-result-chunk.use-case');
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
    chunkHandler = app.get(HandleChunk);
    processJob = app.get(ProcessJob);
    // The adapters' own connections: cutting one stands in for Redis being
    // down for that adapter only.
    quotaClient = (app.get<object>(AI_QUOTA) as unknown as RedisClientHolder)
      .client;
    cacheClient = (
      app.get<object>(AI_RESPONSE_CACHE) as unknown as RedisClientHolder
    ).client;
    redisClient = new Redis({
      host: redis.env.REDIS_HOST,
      port: Number(redis.env.REDIS_PORT),
    });
  }, 240_000);

  afterAll(async () => {
    await redisClient?.quit().catch(() => undefined);
    await app?.close();
    await stopContainer(pg?.container);
    await mongo?.server.stop();
    await stopContainer(redis?.container);
  });

  beforeEach(async () => {
    gateway.reset();
    await resetAiKeys();
  });

  describe('daily quota on suggestions', () => {
    it('lets a user make 10 requests, then 429s the 11th with Retry-After and the uniform error body; another user still works', async () => {
      const a = await newAccount('quota-a');
      const doc = await newDocument(a);
      for (let i = 0; i < USER_LIMIT; i += 1) {
        const section = await newSection(a, doc, `Distinct text ${i}`);
        await suggest(a, section).expect(201);
      }
      expect(gateway.requests).toHaveLength(USER_LIMIT);

      const over = await newSection(a, doc, 'One too many');
      const res = await suggest(a, over).expect(429);

      expect(res.body).toMatchObject({
        statusCode: 429,
        message: QUOTA_MESSAGE,
        error: 'Too Many Requests',
        path: `/sections/${over}/suggestions`,
      });
      expect(res.body.timestamp).toEqual(expect.any(String));
      const retryAfter = Number(res.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(86_400);
      // The refused request reached no provider and counted nothing.
      expect(gateway.requests).toHaveLength(USER_LIMIT);
      expect(await userUsed(a)).toBe(USER_LIMIT);
      expect(await globalUsed()).toBe(USER_LIMIT);

      const b = await newAccount('quota-b');
      const bSection = await newSection(b, await newDocument(b), 'B text');
      await suggest(b, bSection).expect(201);
      expect(await userUsed(b)).toBe(1);
    });

    it('serves a cache hit even when the user is over quota, without using any', async () => {
      const a = await newAccount('quota-hit');
      const doc = await newDocument(a);
      const first = await newSection(a, doc, 'Reusable text');
      await suggest(a, first).expect(201);
      await redisClient.set(
        userQuotaKey(a.userId, today()),
        String(USER_LIMIT),
      );

      await suggest(a, first).expect(201);
      const fresh = await newSection(a, doc, 'Brand new text');
      await suggest(a, fresh).expect(429);

      expect(gateway.requests).toHaveLength(1);
      expect(await userUsed(a)).toBe(USER_LIMIT);
    });

    it('blocks everyone once the global limit is spent', async () => {
      await redisClient.set(globalQuotaKey(today()), String(GLOBAL_LIMIT));
      const a = await newAccount('global-a');
      const b = await newAccount('global-b');

      for (const account of [a, b]) {
        const section = await newSection(
          account,
          await newDocument(account),
          'Global text',
        );
        const res = await suggest(account, section).expect(429);
        expect(res.headers['retry-after']).toBeDefined();
      }
      expect(gateway.requests).toHaveLength(0);
      expect(await userUsed(a)).toBe(0);
      expect(await globalUsed()).toBe(GLOBAL_LIMIT);
    });

    it('counts every provider attempt, so two attempts in one call use two units', async () => {
      const a = await newAccount('quota-attempts');
      const doc = await newDocument(a);
      gateway.attemptsPerCall = 2;

      await suggest(a, await newSection(a, doc, 'Retried text')).expect(201);

      expect(await userUsed(a)).toBe(2);
      expect(await globalUsed()).toBe(2);
    });

    it('stops a call part-way when a later attempt is refused, and returns 429', async () => {
      const a = await newAccount('quota-midway');
      await redisClient.set(
        userQuotaKey(a.userId, today()),
        String(USER_LIMIT - 1),
      );
      gateway.attemptsPerCall = 2;

      await suggest(
        a,
        await newSection(a, await newDocument(a), 'Midway text'),
      ).expect(429);

      expect(gateway.requests).toHaveLength(0);
      expect(await userUsed(a)).toBe(USER_LIMIT);
    });
  });

  describe('response cache', () => {
    it('serves an identical request from the cache: no provider call, no quota, and a normal row', async () => {
      const a = await newAccount('cache-a');
      const doc = await newDocument(a);
      const section = await newSection(a, doc, 'Cache me please');

      const first = await suggest(a, section).expect(201);
      const second = await suggest(a, section).expect(201);

      expect(gateway.requests).toHaveLength(1);
      expect(await userUsed(a)).toBe(1);
      expect(second.body.suggested_text).toBe(first.body.suggested_text);
      expect(second.body.model).toBe('scripted/model');
      expect(second.body.id).not.toBe(first.body.id);
      const list = await request(app.getHttpServer())
        .get(`/sections/${section}/suggestions`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200);
      expect(list.body).toHaveLength(2);
    });

    it('does not give user B the text cached for user A, even for identical content', async () => {
      const a = await newAccount('iso-a');
      const b = await newAccount('iso-b');
      const content = 'Exactly the same words in both documents';
      const aSection = await newSection(a, await newDocument(a), content);
      const bSection = await newSection(b, await newDocument(b), content);

      const forA = await suggest(a, aSection).expect(201);
      const forB = await suggest(b, bSection).expect(201);

      expect(gateway.requests).toHaveLength(2);
      expect(forA.body.suggested_text).toBe('Reply #1');
      expect(forB.body.suggested_text).toBe('Reply #2');
    });

    it('stores no plaintext: the cache key is a digest and only text and model are the value', async () => {
      const a = await newAccount('cache-shape');
      const content = 'Plaintext that must not appear in a key';
      await suggest(
        a,
        await newSection(a, await newDocument(a), content),
      ).expect(201);

      const keys = await redisClient.keys('ai-cache:*');
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^ai-cache:suggestion:[0-9a-f]{64}$/);
      expect(keys[0]).not.toContain(a.userId);
      const value = JSON.parse((await redisClient.get(keys[0]))!) as object;
      expect(Object.keys(value).sort()).toEqual(['model', 'suggestedText']);
    });
  });

  describe('Redis outage', () => {
    afterEach(async () => {
      await restore(quotaClient);
      await restore(cacheClient);
    });

    it('refuses AI with 503 and makes no provider call when the quota cannot be reached (fail closed)', async () => {
      const a = await newAccount('down-quota');
      const section = await newSection(a, await newDocument(a), 'Down text');
      cut(quotaClient);

      const res = await suggest(a, section).expect(503);

      expect(res.body.message).toBe(
        'AI usage limits are temporarily unavailable',
      );
      expect(gateway.requests).toHaveLength(0);
      await restore(quotaClient);
      await suggest(a, section).expect(201);
    });

    it('refuses a planning job submission with 503 when the quota cannot be reached', async () => {
      const a = await newAccount('down-submit');
      cut(quotaClient);

      await submitJob(a).expect(503);

      expect(gateway.requests).toHaveLength(0);
    });

    it('keeps serving when only the cache fails (fail open): a miss, the provider is called', async () => {
      const a = await newAccount('down-cache');
      const section = await newSection(a, await newDocument(a), 'Cache down');
      cut(cacheClient);

      const first = await suggest(a, section).expect(201);
      const second = await suggest(a, section).expect(201);

      expect(first.body.suggested_text).toBe('Reply #1');
      expect(second.body.suggested_text).toBe('Reply #2');
      expect(gateway.requests).toHaveLength(2);
      expect(await userUsed(a)).toBe(2);
    });
  });

  describe('planning jobs', () => {
    it('429s an over-quota submission with Retry-After and creates no job', async () => {
      const a = await newAccount('plan-over');
      await redisClient.set(
        userQuotaKey(a.userId, today()),
        String(USER_LIMIT),
      );

      const res = await submitJob(a).expect(429);

      expect(res.body).toMatchObject({
        statusCode: 429,
        message: QUOTA_MESSAGE,
        error: 'Too Many Requests',
      });
      expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(await userUsed(a)).toBe(USER_LIMIT);
    });

    it('does not count the submission itself; the worker reserves per provider attempt', async () => {
      const a = await newAccount('plan-count');

      const res = await submitJob(a).expect(202);
      const job = await untilTerminal(a, res.body.job_id as string);

      expect(job.status).toBe('completed');
      expect(await userUsed(a)).toBe(1);
    });

    it('marks a job failed with AI_QUOTA_EXCEEDED when the cap runs out at the worker', async () => {
      const a = await newAccount('plan-worker');
      await redisClient.set(
        userQuotaKey(a.userId, today()),
        String(USER_LIMIT - 1),
      );
      // The submit check passes (9 of 10); the call then makes two attempts.
      gateway.attemptsPerCall = 2;

      const res = await submitJob(a).expect(202);
      const job = await untilTerminal(a, res.body.job_id as string);

      expect(job.status).toBe('failed');
      expect(job.error_code).toBe('AI_QUOTA_EXCEEDED');
      expect(job.error_message).toBe(QUOTA_MESSAGE);
      expect(gateway.requests).toHaveLength(0);
    });

    it('marks a job failed with AI_QUOTA_UNAVAILABLE when the counters go away at the worker', async () => {
      const a = await newAccount('plan-worker-down');
      gateway.beforeCall = () => {
        cut(quotaClient);
        return Promise.resolve();
      };

      try {
        const res = await submitJob(a).expect(202);
        const job = await untilTerminal(a, res.body.job_id as string);

        expect(job.status).toBe('failed');
        expect(job.error_code).toBe('AI_QUOTA_UNAVAILABLE');
        expect(job.error_message).toBe(
          'AI usage limits are temporarily unavailable',
        );
        expect(gateway.requests).toHaveLength(0);
      } finally {
        await restore(quotaClient);
      }
    });
  });

  describe('worker re-checks the user', () => {
    async function queuedJobOfDisabledUser(label: string) {
      const a = await newAccount(label);
      const job = await jobRepository.create({
        userId: a.userId,
        prompt: 'Plan while disabled',
        connectors: [],
        documentId: null,
        sectionId: null,
      });
      await sql(`UPDATE users SET disabled_at = now() WHERE id = $1`, [
        a.userId,
      ]);
      return { account: a, jobId: job.id };
    }

    it('fails the job with USER_INACTIVE and calls no provider (in-process path)', async () => {
      const { jobId } = await queuedJobOfDisabledUser('inactive-legacy');

      const { processed, job } = await processJob.execute({ jobId });

      expect(processed).toBe(true);
      expect(job.status).toBe('failed');
      expect(job.errorCode).toBe('USER_INACTIVE');
      expect(job.errorMessage).toBe(
        'The account that submitted this job is not active',
      );
      expect(gateway.requests).toHaveLength(0);
      expect(await globalUsed()).toBe(0);
    });

    it('fails the job with USER_INACTIVE and calls no provider (RabbitMQ result path)', async () => {
      const { account, jobId } =
        await queuedJobOfDisabledUser('inactive-chunks');
      await jobRepository.claimForGathering(jobId);

      const done = await chunkHandler.execute({
        chunk: {
          schemaVersion: 1,
          jobId,
          userId: account.userId,
          sequence: 0,
          type: 'status',
          status: { phase: 'completed' },
        },
      });

      expect(done.job?.status).toBe('failed');
      expect(done.job?.errorCode).toBe('USER_INACTIVE');
      expect(gateway.requests).toHaveLength(0);
      expect(await globalUsed()).toBe(0);
    });
  });

  describe('active prompt cache', () => {
    it('applies a newly activated prompt at once', async () => {
      const admin = await newAccount('prompt-admin');
      await promoteToAdmin(pg.env, admin.email);
      const section = await newSection(
        admin,
        await newDocument(admin),
        'Prompt switch text',
      );

      const before = await suggest(admin, section).expect(201);
      expect(gateway.requests[0].user).not.toContain('ACTIVATED-MARKER');

      const created = await request(app.getHttpServer())
        .post('/admin/prompts')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          feature_type: 'suggestion',
          version: 'e2e-quota-cache',
          system_template: 'Sys <untrusted_{{nonce}}>',
          user_template:
            'ACTIVATED-MARKER <untrusted_{{nonce}}>{{content}}</untrusted_{{nonce}}>',
        })
        .expect(201);
      // Created but not active: the cached prompt is still the old one.
      await suggest(admin, section).expect(201);
      expect(gateway.requests.at(-1)!.user).not.toContain('ACTIVATED-MARKER');

      await request(app.getHttpServer())
        .post(`/admin/prompts/${created.body.id as string}/activate`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      const after = await suggest(admin, section).expect(201);

      expect(gateway.requests.at(-1)!.user).toContain('ACTIVATED-MARKER');
      expect(after.body.prompt_version).toBe('e2e-quota-cache');
      expect(after.body.prompt_version).not.toBe(before.body.prompt_version);
    });
  });

  describe('connectors at submission', () => {
    it('gives a foreign connection, an inactive one and an unknown one the same 400', async () => {
      const owner = await newAccount('conn-owner');
      const other = await newAccount('conn-other');
      await sql(
        `INSERT INTO connector_connections (user_id, provider, composio_account_id, status, connected_at)
         VALUES ($1, 'trello', 'ca_quota_e2e', 'active', now())`,
        [owner.userId],
      );

      const foreign = await submitJob(other, { connectors: ['trello'] }).expect(
        400,
      );
      const unknown = await submitJob(other, {
        connectors: ['no-such-connector'],
      }).expect(400);

      expect(foreign.body.message).toBe(unknown.body.message);
      expect(foreign.body.error).toBe(unknown.body.error);
      expect(foreign.body.message).toBe(
        'Connectors must be among your active connections',
      );

      const own = await submitJob(owner, { connectors: ['trello'] }).expect(
        202,
      );
      expect(own.body.job_id).toEqual(expect.any(String));
    });

    it('bounds the connectors array and each item', async () => {
      const a = await newAccount('conn-bounds');

      await submitJob(a, { connectors: Array(11).fill('trello') }).expect(400);
      await submitJob(a, { connectors: ['x'.repeat(65)] }).expect(400);
    });
  });
});
