import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { SuggestionGeneratorRateLimitedError } from './../src/domain/ai/suggestion-generation.errors';
import type { LlmPlanner } from './../src/domain/context/llm-planner.port';
import { App } from 'supertest/types';
import { acceptAiConsent } from './utils/ai-consent';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';
import { startRedisContainer, RedisTestEnv } from './utils/redis-testcontainer';
import { registerUser } from './utils/register-user';
import { stopContainer } from './utils/stop-container';

// Booting AppModule requires a live PostgreSQL (users/auth) and Redis
// (BullMQ planning queue), both provided by Testcontainers — gated
// identically to the PG-only suites (skip locally without Docker, hard-fail
// in CI). MongoDB comes from mongodb-memory-server.
/**
 * Echo planner that is rate-limited on demand: a prompt starting with
 * `RL-ONCE` fails its first call, `RL-ALWAYS` fails every call.
 */
function makeRateLimitedPlanner(): LlmPlanner {
  const seen = new Map<string, number>();
  return {
    plan: (input) => {
      const calls = (seen.get(input.prompt) ?? 0) + 1;
      seen.set(input.prompt, calls);
      if (
        input.prompt.startsWith('RL-ALWAYS') ||
        (input.prompt.startsWith('RL-ONCE') && calls === 1)
      ) {
        return Promise.reject(new SuggestionGeneratorRateLimitedError());
      }
      return Promise.resolve({
        suggestions: [`(stub plan) ${input.prompt}`],
        outline: null,
        sources: [],
        model: null,
      });
    },
  };
}

describeWithDocker()('Context / planning jobs (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;

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

    const token = loginRes.body.accessToken as string;
    await acceptAiConsent(app, token);
    return token;
  }

  async function pollUntilTerminal(
    jobId: string,
    token: string,
    timeoutMs = 20_000,
  ): Promise<{ status: string; result: unknown }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await request(app.getHttpServer())
        .get(`/planning-jobs/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      if (res.body.status === 'completed' || res.body.status === 'failed') {
        return res.body as { status: string; result: unknown };
      }

      if (Date.now() > deadline) {
        throw new Error(
          `Planning job ${jobId} did not reach a terminal state within ${timeoutMs}ms (last status: ${res.body.status})`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
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
    const { LLM_PLANNER } =
      await import('./../src/domain/context/llm-planner.port');
    const { PLANNING_RETRY_POLICY } =
      await import('./../src/application/context/planning-retry');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LLM_PLANNER)
      .useValue(makeRateLimitedPlanner())
      // Short delays: the real ones are 30 s and 120 s.
      .overrideProvider(PLANNING_RETRY_POLICY)
      .useValue({ baseDelaysMs: [300, 300], maxDelayMs: 1000 })
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
    await stopContainer(pg?.container);
    await mongo?.server.stop();
    await stopContainer(redis?.container);
  });

  it('POST /planning-jobs requires a token (401 without one)', async () => {
    await request(app.getHttpServer())
      .post('/planning-jobs')
      .send({ prompt: 'Plan my chapter' })
      .expect(401);
  });

  it('GET /planning-jobs/:id requires a token (401 without one)', async () => {
    await request(app.getHttpServer())
      .get('/planning-jobs/000000000000000000000000')
      .expect(401);
  });

  it(
    'submits a planning job (202 + pending), processes it in-worker, and ' +
      'the REST fallback returns the completed echo result',
    async () => {
      const token = await registerAndLogin('planner@example.com');

      const submitRes = await request(app.getHttpServer())
        .post('/planning-jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: 'Draft an outline for chapter 3' })
        .expect(202);

      expect(submitRes.body.job_id).toEqual(expect.any(String));
      expect(submitRes.body.status).toBe('pending');

      const jobId = submitRes.body.job_id as string;
      const finalState = await pollUntilTerminal(jobId, token);

      expect(finalState.status).toBe('completed');
      expect(finalState.result).toEqual({
        suggestions: ['(stub plan) Draft an outline for chapter 3'],
        outline: null,
        sources: [],
      });
    },
    30_000,
  );

  it('GET /planning-jobs/:id returns 404 (not 500) for a malformed (non-ObjectId) id', async () => {
    const token = await registerAndLogin('malformed-id@example.com');

    await request(app.getHttpServer())
      .get('/planning-jobs/not-a-valid-object-id')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("returns 404 (not another user's data) when requesting someone else's job", async () => {
    const ownerToken = await registerAndLogin('owner@example.com');
    const submitRes = await request(app.getHttpServer())
      .post('/planning-jobs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ prompt: 'Owner-only prompt' })
      .expect(202);
    const jobId = submitRes.body.job_id as string;

    const otherToken = await registerAndLogin('someone-else@example.com');

    await request(app.getHttpServer())
      .get(`/planning-jobs/${jobId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('retries a rate-limited planning job later (stays non-terminal) and completes it', async () => {
    const token = await registerAndLogin('retry-ok@example.com');
    const submitRes = await request(app.getHttpServer())
      .post('/planning-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'RL-ONCE outline' })
      .expect(202);
    const jobId = submitRes.body.job_id as string;

    // First attempt is rate-limited: parked, not failed.
    let waiting: { status: string; planning_retry_count: number } | null = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const res = await request(app.getHttpServer())
        .get(`/planning-jobs/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = res.body as {
        status: string;
        planning_retry_count: number;
        next_retry_at: string | null;
      };
      if (body.planning_retry_count === 1 && body.next_retry_at) {
        waiting = body;
        break;
      }
      if (body.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    // The retry is quick (300 ms); seeing the waiting state is best effort.
    if (waiting) expect(['running', 'planning']).toContain(waiting.status);

    const finalState = await pollUntilTerminal(jobId, token);
    expect(finalState.status).toBe('completed');
    expect(finalState.result).toEqual({
      suggestions: ['(stub plan) RL-ONCE outline'],
      outline: null,
      sources: [],
    });
  }, 30_000);

  it('fails with AI_PROVIDER_RATE_LIMITED after two retries', async () => {
    const token = await registerAndLogin('retry-fail@example.com');
    const submitRes = await request(app.getHttpServer())
      .post('/planning-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'RL-ALWAYS outline' })
      .expect(202);
    const jobId = submitRes.body.job_id as string;

    const finalState = await pollUntilTerminal(jobId, token);
    expect(finalState.status).toBe('failed');
    const res = await request(app.getHttpServer())
      .get(`/planning-jobs/${jobId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.error_code).toBe('AI_PROVIDER_RATE_LIMITED');
    expect(res.body.planning_retry_count).toBe(2);
    expect(res.body.next_retry_at).toBeNull();
  }, 30_000);
});
