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

interface PlanningJobBody {
  job_id: string;
  status: string;
  result: unknown;
}

async function registerAndLogin(
  app: INestApplication<App>,
  email: string,
): Promise<string> {
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
  app: INestApplication<App>,
  jobId: string,
  token: string,
  timeoutMs = 20_000,
): Promise<PlanningJobBody> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app.getHttpServer())
      .get(`/planning-jobs/${jobId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    if (res.body.status === 'completed' || res.body.status === 'failed') {
      return res.body as PlanningJobBody;
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Planning job ${jobId} did not reach a terminal state within ${timeoutMs}ms (last status: ${res.body.status})`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Deliberately its OWN file (own Jest worker/process) rather than a second
 * `describe` block inside `rabbitmq-transport.e2e-spec.ts` — this suite
 * proves the two context-gather transports coexist by booting the app
 * WITHOUT `RABBITMQ_URL` and confirming the legacy synchronous HTTP/stub
 * gather+plan path still works, and it must be immune to anything going
 * wrong with the RabbitMQ Testcontainer (a slow/failed start, a wedged
 * amqp-connection-manager background reconnect loop, a slow teardown) in
 * that other file — sharing a file/worker would mean a RabbitMQ container
 * problem could fail this suite too, even though it has no RabbitMQ
 * dependency whatsoever. Own containers (PG/Redis/Mongo), own app
 * instance; with `RABBITMQ_URL` unset, `ContextModule` never binds
 * `CONTEXT_REQUEST_PUBLISHER`, so `ProcessPlanningJobUseCase` takes its
 * legacy branch exactly as `test/context.e2e-spec.ts` (left completely
 * unmodified) already covers.
 */
describeWithDocker()(
  'RabbitMQ context-engine transport — flag off (e2e)',
  () => {
    let app: INestApplication<App>;
    let pg: PgTestEnv;
    let mongo: MongoTestEnv;
    let redis: RedisTestEnv;

    beforeAll(async () => {
      pg = await startPgContainer();
      mongo = await startMongoMemory();
      redis = await startRedisContainer();

      Object.assign(process.env, pg.env, redis.env, {
        MONGODB_URI: mongo.uri,
        JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars-long',
        JWT_EXPIRES_IN: '15m',
        COMPOSIO_API_KEY: 'test-only-composio-key',
        COMPOSIO_AUTH_CONFIG_IDS:
          'trello:ac_test,notion:ac_test,github:ac_test',
        COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
      });
      // Explicit, not merely "never set" — guards against a leaked value
      // from another suite's `Object.assign` if Jest ever reuses a worker's
      // process.env across files (it shouldn't, but this makes the
      // flag-off intent unambiguous regardless).
      delete process.env.RABBITMQ_URL;

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
      await app?.close().catch(() => undefined);
      await pg?.container.stop().catch(() => undefined);
      await mongo?.server.stop().catch(() => undefined);
      await redis?.container.stop().catch(() => undefined);
    }, 60_000);

    it(
      'submits and completes a planning job via the legacy stub gather+plan ' +
        'path when RABBITMQ_URL is unset',
      async () => {
        const token = await registerAndLogin(
          app,
          'legacy-still-works@example.com',
        );

        const submitRes = await request(app.getHttpServer())
          .post('/planning-jobs')
          .set('Authorization', `Bearer ${token}`)
          .send({ prompt: 'Legacy path must still work' })
          .expect(202);
        expect(submitRes.body.status).toBe('pending');

        const jobId = submitRes.body.job_id as string;
        const finalState = await pollUntilTerminal(app, jobId, token);

        expect(finalState.status).toBe('completed');
        expect(finalState.result).toEqual({
          suggestions: ['(stub plan) Legacy path must still work'],
          outline: null,
          sources: [],
        });
      },
      30_000,
    );
  },
);
