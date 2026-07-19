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
  CTX_GATHER_REQUESTS_DLQ,
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
 * published, so it can echo `job_id`/`user_id` back in its result chunks.
 *
 * The consumer MUST be cancelled once it has served its one message (or
 * timed out): a leaked consumer stays subscribed for the rest of the suite,
 * and RabbitMQ round-robins later tests' messages to it — exactly the
 * "messageCount=0, consumerCount=N, wait timed out" failure CI round 3's
 * diagnostics exposed. Cancellation is race-safe: if the delivery callback
 * fires before amqplib hands us the consumerTag, we flag the cancel and
 * perform it as soon as the tag arrives. */
function waitForOneMessage(
  channel: amqplib.Channel,
  queue: string,
  timeoutMs = 15_000,
): Promise<amqplib.ConsumeMessage> {
  return new Promise((resolve, reject) => {
    let consumerTag: string | null = null;
    let cancelWanted = false;

    const cancelConsumer = () => {
      cancelWanted = true;
      if (consumerTag !== null) {
        const tag = consumerTag;
        consumerTag = null;
        void channel.cancel(tag).catch(() => undefined);
      }
    };

    const timeout = setTimeout(() => {
      cancelConsumer();
      reject(new Error(`Timed out waiting for a message on "${queue}"`));
    }, timeoutMs);

    channel
      .consume(queue, (msg) => {
        if (!msg) return;
        clearTimeout(timeout);
        channel.ack(msg);
        cancelConsumer();
        resolve(msg);
      })
      .then((ok) => {
        consumerTag = ok.consumerTag;
        if (cancelWanted) cancelConsumer();
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

/**
 * Polls `GET /planning-jobs/:id` in the background and records every
 * DISTINCT status seen (pending -> gathering -> planning ->
 * completed/failed), so a failure can show the actual sequence observed
 * rather than just a final snapshot. Diagnostics only — polling failures
 * are swallowed (the test's own assertions are what fail loudly); call
 * `stop()` once the test's own wait resolves either way.
 */
function observeStatusTransitions(
  app: INestApplication<App>,
  jobId: string,
  token: string,
  intervalMs = 500,
): { stop: () => void; transitions: () => string[] } {
  const seen: string[] = [];
  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      try {
        const res = await request(app.getHttpServer())
          .get(`/planning-jobs/${jobId}`)
          .set('Authorization', `Bearer ${token}`);
        const status = (res.body?.status as string | undefined) ?? 'unknown';
        if (seen[seen.length - 1] !== status) {
          seen.push(status);
        }
      } catch {
        // Diagnostics only — never let a poll failure crash the observer.
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  };
  void loop();

  return {
    stop: () => {
      stopped = true;
    },
    transitions: () => [...seen],
  };
}

/**
 * On a `waitForOneMessage` timeout, turns an opaque "timed out" into a
 * pinpointed cause by dumping: the job's current status/error_code (was the
 * worker even claimed it? did it fail before publishing?), the observed
 * status-transition sequence, and both queues' message counts (empty
 * `ctx.gather.requests` + empty DLQ = the publish never happened at all;
 * a message sitting in the DLQ = a topology/routing mismatch, not a
 * publish failure).
 */
async function diagnoseTimeout(
  app: INestApplication<App>,
  jobId: string,
  token: string,
  channel: amqplib.Channel,
  transitions: string[],
  label: string,
): Promise<void> {
  let statusLine = 'unavailable';
  try {
    const res = await request(app.getHttpServer())
      .get(`/planning-jobs/${jobId}`)
      .set('Authorization', `Bearer ${token}`);
    statusLine =
      `status=${res.body?.status as string | undefined} ` +
      `error_code=${res.body?.error_code as string | null | undefined} ` +
      `error_message=${res.body?.error_message as string | null | undefined}`;
  } catch (err) {
    statusLine = `<failed to fetch job: ${err instanceof Error ? err.message : String(err)}>`;
  }

  const describeQueue = async (queue: string): Promise<string> => {
    try {
      const { messageCount, consumerCount } = await channel.checkQueue(queue);
      return `${queue}: messageCount=${messageCount} consumerCount=${consumerCount}`;
    } catch (err) {
      return `${queue}: <checkQueue failed: ${err instanceof Error ? err.message : String(err)}>`;
    }
  };
  const [requestsQueueLine, dlqLine] = await Promise.all([
    describeQueue(CTX_GATHER_REQUESTS_QUEUE),
    describeQueue(CTX_GATHER_REQUESTS_DLQ),
  ]);

  console.error(
    `[diagnose:${label}] job ${jobId} — ${statusLine}\n` +
      `[diagnose:${label}] status transitions observed: ${transitions.join(' -> ') || '<none>'}\n` +
      `[diagnose:${label}] ${requestsQueueLine}\n` +
      `[diagnose:${label}] ${dlqLine}`,
  );
}

/**
 * Forces a bare `localhost` hostname to the IPv4 loopback literal.
 *
 * Node >=17 resolves `localhost` in whatever order the OS/DNS returns
 * (no IPv4-first preference by default), and on some CI Docker daemons the
 * published container port is only reachable on the IPv4 loopback — a
 * connection attempt that lands on `::1` first (or exclusively, depending
 * on `net.connect`'s `autoSelectFamily` support on the runner's Node
 * version) can produce a persistent `ECONNREFUSED` that never falls
 * through to the address that's actually listening. Using the IPv4 literal
 * directly skips DNS resolution entirely (`net.isIP` short-circuits it in
 * both `amqplib` and Node's own `net.connect`), removing the ambiguity.
 *
 * Round-tripping through the WHATWG `URL` class leaves a path-less
 * `amqp://` URL's empty path unchanged (empty-path-to-`/` normalization
 * only applies to special schemes like http/ws, not `amqp:`). Either way
 * the resolved vhost is unaffected — amqplib treats both `''` and `/` as
 * "use the default vhost".
 */
function forceIPv4(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
    }
    return url.toString();
  } catch {
    // Defensive fallback only — `new URL` handles `amqp://` URLs fine in
    // every Node version this project targets, but never let a parsing
    // quirk crash the whole e2e setup over a cosmetic hostname swap.
    return rawUrl.replace('localhost', '127.0.0.1');
  }
}

/** Prefers `getAmqpUrl()` (present on `@testcontainers/rabbitmq` today) but
 * falls back to building the URL manually from `getHost()`/
 * `getMappedPort()` in case that API ever changes shape — then forces IPv4
 * per `forceIPv4`'s doc comment. */
function buildRabbitMqUrl(container: StartedRabbitMQContainer): string {
  const raw =
    typeof container.getAmqpUrl === 'function'
      ? container.getAmqpUrl()
      : `amqp://${container.getHost()}:${container.getMappedPort(5672)}`;
  return forceIPv4(raw);
}

/**
 * Raw, retried amqplib connect against the built URL — a pre-flight check
 * so a broker that's unreachable (container reports "started" but the AMQP
 * listener isn't actually accepting connections yet, a known source of
 * flakiness with `Wait.forLogMessage("Server startup complete")` on
 * resource-constrained CI runners) fails fast with a clear, diagnosable
 * error instead of the app's `amqp-connection-manager` retrying silently
 * in the background until individual test assertions time out generically.
 */
async function preflightRabbitMq(
  url: string,
  attempts = 15,
  delayMs = 2_000,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const conn = await amqplib.connect(url, { timeout: 5_000 });
      await conn.close();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  const lastErrMessage =
    lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `RabbitMQ pre-flight failed: could not connect to "${url}" after ` +
      `${attempts} attempts (${(attempts * delayMs) / 1000}s). Last error: ` +
      `${lastErrMessage}`,
  );
}

// Boots the full AppModule against Testcontainers PostgreSQL + Redis + a
// real RabbitMQ broker (in-memory Mongo), with RABBITMQ_URL set — the
// queue-transport path (docs/contracts/context-engine.md). Docker-gated
// like the rest of the PG-backed e2e suites. Deliberately its OWN file
// (not sharing a Jest worker/module registry with the flag-off suite in
// `rabbitmq-transport-flag-off.e2e-spec.ts`) — a RabbitMQ container
// problem (slow start, background reconnect noise, a wedged teardown)
// must never be able to fail a suite that has nothing to do with it.
describeWithDocker()('RabbitMQ context-engine transport (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;
  let rabbitmq: StartedRabbitMQContainer;
  let rabbitmqUrl: string;
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

    try {
      rabbitmq = await new RabbitMQContainer('rabbitmq:3.13-alpine')
        // Default is 30s — generous headroom for a cold image pull +
        // Erlang VM boot on a CI runner that's also starting PG/Redis/Mongo
        // concurrently, so a genuinely slow (not broken) start doesn't get
        // misreported as "container failed".
        .withStartupTimeout(120_000)
        .start();
    } catch (err) {
      // Fail loudly and unambiguously at the describe level — every test
      // below would otherwise report its own generic, harder-to-diagnose
      // timeout instead of the real "container never started" cause.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`RabbitMQ Testcontainer failed to start: ${message}`, {
        cause: err,
      });
    }

    rabbitmqUrl = buildRabbitMqUrl(rabbitmq);

    // Pre-flight: the container reporting "started" (its log-message wait
    // strategy matched) does not guarantee the AMQP listener is already
    // accepting external connections — confirm it actually is, with a
    // clear, URL-bearing error if not, before wiring up the app or the
    // fake CE against it.
    await preflightRabbitMq(rabbitmqUrl);

    // RABBITMQ_URL (and everything else) MUST land in process.env before
    // `Test.createTestingModule(...).compile()` below — that's what runs
    // `ConfigModule`'s `validate(process.env)`, and `ContextModule`'s
    // RabbitMQ-gated providers (CONTEXT_REQUEST_PUBLISHER/
    // GATHER_TIMEOUT_SCHEDULER/ContextResultsConsumer) read the resulting
    // cached `ConfigService` value, not a live `process.env` read at
    // request time. This mirrors how every other e2e suite here injects
    // CONTEXT_ENGINE_URL/etc. before compiling the module.
    Object.assign(process.env, pg.env, redis.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
      COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
      RABBITMQ_URL: rabbitmqUrl,
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

    // Import late so ConfigModule validation sees the test env vars set
    // above (including RABBITMQ_URL, which is what switches ContextModule's
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
    // Same exact URL the app used (built once, above) — never re-derived.
    ceConnection = await amqplib.connect(rabbitmqUrl);
    ceChannel = await ceConnection.createChannel();
    // Hook budget must exceed container startup (120s, .withStartupTimeout
    // above) + worst-case preflight (15 attempts x (5s connect timeout + 2s
    // delay) = 105s) + PG/Mongo/app boot slack, so a slow-but-healthy runner
    // fails with preflight's diagnosable error, never Jest's generic hook
    // timeout. Keep these numbers in sync if either side changes.
  }, 300_000);

  afterAll(async () => {
    // Each teardown step is independent — one failing/hanging step must
    // never prevent the others from at least being attempted.
    await ceChannel?.close().catch(() => undefined);
    await ceConnection?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
    await pg?.container.stop().catch(() => undefined);
    await mongo?.server.stop().catch(() => undefined);
    await redis?.container.stop().catch(() => undefined);
    await rabbitmq?.stop().catch(() => undefined);
  }, 60_000);

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

      const observer = observeStatusTransitions(app, jobId, token);
      let msg: amqplib.ConsumeMessage;
      try {
        msg = await received;
      } catch (err) {
        await diagnoseTimeout(
          app,
          jobId,
          token,
          ceChannel,
          observer.transitions(),
          'request-publish',
        );
        throw err;
      } finally {
        observer.stop();
      }
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

      const observer = observeStatusTransitions(app, jobId, token);
      let requestMsg: amqplib.ConsumeMessage;
      try {
        requestMsg = await received;
      } catch (err) {
        await diagnoseTimeout(
          app,
          jobId,
          token,
          ceChannel,
          observer.transitions(),
          'completed-flow',
        );
        throw err;
      } finally {
        observer.stop();
      }
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

      const observer = observeStatusTransitions(app, jobId, token);
      let requestMsg: amqplib.ConsumeMessage;
      try {
        requestMsg = await received;
      } catch (err) {
        await diagnoseTimeout(
          app,
          jobId,
          token,
          ceChannel,
          observer.transitions(),
          'failed-flow',
        );
        throw err;
      } finally {
        observer.stop();
      }
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
