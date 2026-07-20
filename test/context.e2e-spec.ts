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

// Booting AppModule requires a live PostgreSQL (users/auth) and Redis
// (BullMQ planning queue), both provided by Testcontainers — gated
// identically to the PG-only suites (skip locally without Docker, hard-fail
// in CI). MongoDB comes from mongodb-memory-server.
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
    await redis?.container.stop();
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
});
