import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as net from 'net';
import * as amqplib from 'amqplib';
import {
  RabbitMQContainer,
  StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';
import {
  CONTEXT_REQUEST_PUBLISHER,
  ContextRequestPublisher,
} from '../src/domain/context/context-request-publisher.port';
import { CTX_GATHER_RESULTS_QUEUE } from '../src/infrastructure/amqp/context-topology';
import { PUBLISH_TIMEOUT_MS } from '../src/infrastructure/amqp/rabbit-context-request.publisher';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';
import { startRedisContainer, RedisTestEnv } from './utils/redis-testcontainer';
import { stopContainer } from './utils/stop-container';

/** Reserves a free local TCP port (nothing listens on it afterwards). */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForConsumer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let conn: amqplib.ChannelModel | undefined;
    try {
      conn = await amqplib.connect(url);
      const ch = await conn.createChannel();
      ch.on('error', () => undefined);
      const q = await ch.checkQueue(CTX_GATHER_RESULTS_QUEUE);
      if (q.consumerCount >= 1) return;
    } catch {
      // broker/queue not ready yet - retry
    } finally {
      await conn?.close().catch(() => undefined);
    }
    if (Date.now() > deadline) {
      throw new Error(`results consumer did not attach within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const sampleRequest = (jobId: string) => ({
  jobId,
  userId: 'user-1',
  prompt: 'hi',
  connectors: [],
  requestedAt: new Date(),
});

/**
 * A set-but-unreachable RABBITMQ_URL must not stop the API from starting:
 * the publisher/consumer `onModuleInit` hooks no longer wait on the broker,
 * amqp-connection-manager keeps retrying in the background. Own file (own
 * worker) so the background reconnect loop can't affect other suites.
 * Tests run in order: boot + bounded publish while the broker is down, then
 * a broker is started on the same port and the app must reconnect.
 */
describeWithDocker()('RabbitMQ unreachable at boot (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;
  let rabbitmq: StartedRabbitMQContainer | undefined;
  let brokerPort: number;

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    redis = await startRedisContainer();
    brokerPort = await getFreePort();

    Object.assign(process.env, pg.env, redis.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars-long',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
      COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
      // A free loopback port with no broker: connection refused until the
      // test starts a broker bound to this same port.
      RABBITMQ_URL: `amqp://guest:guest@127.0.0.1:${brokerPort}`,
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
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
  }, 180_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    await rabbitmq?.stop().catch(() => undefined);
    await stopContainer(pg?.container).catch(() => undefined);
    await mongo?.server.stop().catch(() => undefined);
    await stopContainer(redis?.container).catch(() => undefined);
  }, 60_000);

  it('completes app.init() and serves /health', async () => {
    const started = Date.now();
    await app.init();
    expect(Date.now() - started).toBeLessThan(20_000);

    await request(app.getHttpServer()).get('/health').expect(200);
  }, 30_000);

  it('rejects publishGatherRequest within the publish timeout while the broker is down', async () => {
    const publisher = app.get<ContextRequestPublisher>(
      CONTEXT_REQUEST_PUBLISHER,
      { strict: false },
    );
    const started = Date.now();
    await expect(
      publisher.publishGatherRequest(sampleRequest('job-unreachable')),
    ).rejects.toThrow('Context engine unavailable');
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(PUBLISH_TIMEOUT_MS - 1_000);
    expect(elapsed).toBeLessThan(PUBLISH_TIMEOUT_MS + 5_000);
  }, 30_000);

  it('reconnects once the broker appears: consumer attaches and publish succeeds', async () => {
    rabbitmq = await new RabbitMQContainer('rabbitmq:3.13-alpine')
      .withExposedPorts({ container: 5672, host: brokerPort })
      .withStartupTimeout(120_000)
      .start();
    const url = `amqp://guest:guest@127.0.0.1:${brokerPort}`;

    await waitForConsumer(url, 90_000);

    const publisher = app.get<ContextRequestPublisher>(
      CONTEXT_REQUEST_PUBLISHER,
      { strict: false },
    );
    await expect(
      publisher.publishGatherRequest(sampleRequest('job-after-reconnect')),
    ).resolves.toBeUndefined();
  }, 180_000);
});
