import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as amqplib from 'amqplib';
import {
  RabbitMQContainer,
  StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';
import {
  CONTEXT_EXCHANGE,
  CTX_GATHER_RESULT_ROUTING_KEY,
  CTX_GATHER_REQUESTS_QUEUE,
} from '../src/infrastructure/amqp/context-topology';
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
  context_used: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
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

/** Consumes exactly one message off `queue` (acking it) and resolves with
 * it — used to let the fake context-engine "witness" the request the API
 * published, so it can echo `job_id`/`user_id` back in its result chunks. */
function waitForOneMessage(
  channel: amqplib.Channel,
  queue: string,
  timeoutMs = 15_000,
): Promise<amqplib.ConsumeMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for a message on "${queue}"`));
    }, timeoutMs);

    channel
      .consume(queue, (msg) => {
        if (!msg) return;
        clearTimeout(timeout);
        channel.ack(msg);
        resolve(msg);
      })
      .catch((err: unknown) => {
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

async function settle(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Boots the full AppModule against Testcontainers PostgreSQL + Redis + a
// real RabbitMQ broker (in-memory Mongo), with RABBITMQ_URL set — the
// queue-transport path (docs/contracts/context-engine.md). Docker-gated
// like the rest of the PG-backed e2e suites.
describeWithDocker()('RabbitMQ context-engine transport (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;
  let rabbitmq: StartedRabbitMQContainer;
  let ceConnection: amqplib.ChannelModel;
  let ceChannel: amqplib.Channel;

  function publishResultChunk(body: Record<string, unknown>): void {
    const jobId = body.job_id as string;
    ceChannel.publish(
      CONTEXT_EXCHANGE,
      CTX_GATHER_RESULT_ROUTING_KEY,
      Buffer.from(JSON.stringify(body), 'utf-8'),
      {
        contentType: 'application/json',
        messageId: jobId,
        correlationId: jobId,
        persistent: true,
        timestamp: Math.floor(Date.now() / 1000),
      },
    );
  }

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    redis = await startRedisContainer();
    rabbitmq = await new RabbitMQContainer('rabbitmq:3.13-alpine').start();

    Object.assign(process.env, pg.env, redis.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
      COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
      RABBITMQ_URL: rabbitmq.getAmqpUrl(),
      CONTEXT_GATHER_TIMEOUT_MS: '120000',
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

    // Import late so ConfigModule validation sees the test env vars
    // (including RABBITMQ_URL, which is what switches ContextModule's
    // CONTEXT_REQUEST_PUBLISHER/GATHER_TIMEOUT_SCHEDULER/
    // ContextResultsConsumer providers on).
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
    // App boot itself asserts the full RabbitMQ topology (exchange, both
    // queues + DLQs, both bindings) idempotently — see
    // RabbitContextRequestPublisher/ContextResultsConsumer's onModuleInit.
    await app.init();

    // A second, independent AMQP connection plays the fake context-engine:
    // consumes ctx.gather.requests, publishes ctx.gather.result chunks.
    ceConnection = await amqplib.connect(rabbitmq.getAmqpUrl());
    ceChannel = await ceConnection.createChannel();
  }, 180_000);

  afterAll(async () => {
    await ceChannel?.close();
    await ceConnection?.close();
    await app?.close();
    await pg?.container.stop();
    await mongo?.server.stop();
    await redis?.container.stop();
    await rabbitmq?.stop();
  });

  it(
    'publishes a ctx.gather.request with the contract body + message ' +
      'properties when a planning job is submitted, and the job moves to gathering',
    async () => {
      const token = await registerAndLogin(app, 'rabbit-request@example.com');
      const received = waitForOneMessage(ceChannel, CTX_GATHER_REQUESTS_QUEUE);

      const submitRes = await request(app.getHttpServer())
        .post('/planning-jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: 'Draft an outline via the RabbitMQ transport' })
        .expect(202);
      const jobId = submitRes.body.job_id as string;
      expect(submitRes.body.status).toBe('pending');

      const msg = await received;
      const body = JSON.parse(msg.content.toString('utf-8')) as Record<
        string,
        unknown
      >;

      expect(body).toEqual({
        schema_version: 1,
        job_id: jobId,
        user_id: expect.any(String),
        prompt: 'Draft an outline via the RabbitMQ transport',
        connectors: [],
        requested_at: expect.any(String),
      });
      expect(msg.properties.messageId).toBe(jobId);
      expect(msg.properties.correlationId).toBe(jobId);
      expect(msg.properties.contentType).toBe('application/json');
      expect(msg.properties.deliveryMode).toBe(2);
      expect(typeof msg.properties.timestamp).toBe('number');

      // Publishing the request transitions the job pending -> gathering —
      // poll the REST fallback (no result chunk published yet, so it
      // should settle there, not advance further).
      await settle();
      const afterPublish = await request(app.getHttpServer())
        .get(`/planning-jobs/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(afterPublish.body.status).toBe('gathering');
    },
    30_000,
  );

  it(
    'completes a job from data + terminal completed chunks published by a ' +
      'fake context engine, ignoring a duplicate sequence',
    async () => {
      const token = await registerAndLogin(app, 'rabbit-completed@example.com');
      const received = waitForOneMessage(ceChannel, CTX_GATHER_REQUESTS_QUEUE);

      const submitRes = await request(app.getHttpServer())
        .post('/planning-jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: 'Plan with fake context engine' })
        .expect(202);
      const jobId = submitRes.body.job_id as string;

      const requestMsg = await received;
      const userId = (
        JSON.parse(requestMsg.content.toString('utf-8')) as { user_id: string }
      ).user_id;

      publishResultChunk({
        schema_version: 1,
        job_id: jobId,
        user_id: userId,
        sequence: 0,
        type: 'data',
        data: {
          provider: 'trello',
          content: '{"cards":[]}',
          token_estimate: 12,
        },
      });
      publishResultChunk({
        schema_version: 1,
        job_id: jobId,
        user_id: userId,
        sequence: 1,
        type: 'data',
        data: { provider: 'notion', content: '{"pages":[]}' },
      });
      publishResultChunk({
        schema_version: 1,
        job_id: jobId,
        user_id: userId,
        sequence: 2,
        type: 'status',
        status: { phase: 'completed' },
      });

      const finalState = await pollUntilTerminal(app, jobId, token);
      expect(finalState.status).toBe('completed');
      expect(finalState.result).toEqual({
        suggestions: ['(stub plan) Plan with fake context engine'],
        outline: null,
        sources: [],
      });
      expect(finalState.context_used).toEqual({
        chunks: [
          { provider: 'trello', content: '{"cards":[]}', tokenEstimate: 12 },
          { provider: 'notion', content: '{"pages":[]}', tokenEstimate: null },
        ],
      });

      // A duplicate (sequence 0, already recorded) must be ignored — even
      // with different (bogus) content, it must never overwrite the
      // already-assembled/completed context.
      publishResultChunk({
        schema_version: 1,
        job_id: jobId,
        user_id: userId,
        sequence: 0,
        type: 'data',
        data: { provider: 'trello', content: 'DUPLICATE-SHOULD-BE-IGNORED' },
      });
      await settle();

      const afterDuplicate = await request(app.getHttpServer())
        .get(`/planning-jobs/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(afterDuplicate.body.context_used).toEqual(finalState.context_used);
      expect(afterDuplicate.body.status).toBe('completed');
    },
    30_000,
  );

  it(
    'fails a job (with the chunk error_code) when the fake context engine ' +
      'publishes a terminal failed status chunk',
    async () => {
      const token = await registerAndLogin(app, 'rabbit-failed@example.com');
      const received = waitForOneMessage(ceChannel, CTX_GATHER_REQUESTS_QUEUE);

      const submitRes = await request(app.getHttpServer())
        .post('/planning-jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: 'This gather will fail' })
        .expect(202);
      const jobId = submitRes.body.job_id as string;

      const requestMsg = await received;
      const userId = (
        JSON.parse(requestMsg.content.toString('utf-8')) as { user_id: string }
      ).user_id;

      publishResultChunk({
        schema_version: 1,
        job_id: jobId,
        user_id: userId,
        sequence: 0,
        type: 'status',
        status: {
          phase: 'failed',
          error_code: 'MCP_UNAVAILABLE',
          message: 'Trello MCP unreachable',
        },
      });

      const finalState = await pollUntilTerminal(app, jobId, token);
      expect(finalState.status).toBe('failed');
      expect(finalState.error_code).toBe('MCP_UNAVAILABLE');
      expect(finalState.error_message).toBe('Trello MCP unreachable');
    },
    30_000,
  );
});

// Same Docker-availability gate, own container set, deliberately WITHOUT
// RABBITMQ_URL — proves the two transports coexist: with the var unset,
// ContextModule never binds CONTEXT_REQUEST_PUBLISHER, so
// ProcessPlanningJobUseCase takes its legacy branch exactly as
// `test/context.e2e-spec.ts` (left completely unmodified) already covers.
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
        JWT_SECRET: 'test-only-secret',
        JWT_EXPIRES_IN: '15m',
        COMPOSIO_API_KEY: 'test-only-composio-key',
        COMPOSIO_AUTH_CONFIG_IDS:
          'trello:ac_test,notion:ac_test,github:ac_test',
        COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
      });
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
      await app?.close();
      await pg?.container.stop();
      await mongo?.server.stop();
      await redis?.container.stop();
    });

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
