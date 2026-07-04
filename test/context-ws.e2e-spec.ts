import type { AddressInfo } from 'node:net';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { io as ioClient, Socket } from 'socket.io-client';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';
import { startRedisContainer, RedisTestEnv } from './utils/redis-testcontainer';

// Same Docker-availability gate as `context.e2e-spec.ts` — this suite boots
// the full AppModule (PostgreSQL + Redis via Testcontainers, in-memory
// Mongo) and additionally exercises the real-time WebSocket push path.
describeWithDocker()('Context / planning-job WebSocket push (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;
  let baseUrl: string;
  const sockets: Socket[] = [];
  // Sockets that have already received the gateway's `ready` event, so a
  // `waitForReady` attached after the emit still resolves (avoids a race).
  const readyReceived = new WeakSet<Socket>();

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

  /**
   * Connects a socket.io client with the given auth token (or no token at
   * all) and resolves once the transport-level `connect` fires. Server-side
   * JWT verification/room-join happens asynchronously *after* that, so
   * callers that need the join to have completed before proceeding (e.g.
   * before submitting a job they expect to be pushed back to this socket)
   * should await `waitForReady` afterwards, which resolves on the gateway's
   * `ready` event — emitted only once the room join succeeds.
   */
  function connectClient(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(baseUrl, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      // Capture `ready` synchronously, here at creation — before the transport
      // round-trip can complete — so a fast server emit can't land in the gap
      // between the caller's `await connectClient` and its later
      // `waitForReady`. `waitForReady` reads this buffer.
      socket.once('ready', () => readyReceived.add(socket));
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for socket connect'));
      }, 10_000);
      socket.on('connect', () => {
        clearTimeout(timeout);
        resolve(socket);
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  function waitForDisconnect(
    socket: Socket,
    timeoutMs = 10_000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!socket.connected) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for socket disconnect'));
      }, timeoutMs);
      socket.on('disconnect', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  function waitForEvent<T>(
    socket: Socket,
    event: string,
    timeoutMs = 15_000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for "${event}"`));
      }, timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });
  }

  // The gateway emits `ready` once JWT verification + the owner-room join
  // complete — awaiting it (instead of a fixed delay) is what makes the
  // handshake-join race deterministic. `connectClient` buffers an already-
  // fired `ready` in `readyReceived`, so resolve immediately in that case.
  function waitForReady(socket: Socket, timeoutMs = 10_000): Promise<void> {
    if (readyReceived.has(socket)) return Promise.resolve();
    return waitForEvent<void>(socket, 'ready', timeoutMs);
  }

  // For the (rare) cases with no event to await — e.g. giving a wrongly
  // cross-delivered event a chance to arrive before asserting its absence.
  async function settle(ms = 300): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    redis = await startRedisContainer();
    Object.assign(process.env, pg.env, redis.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
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
    // Socket.io needs a real listening HTTP server (unlike the REST-only
    // suites, which never call listen()). `getHttpServer()` is typed as the
    // `App` (Express) interface, not the underlying `net.Server` — narrow
    // explicitly rather than casting through `App`, which doesn't have
    // `.address()` and fails under full type-checking.
    await app.listen(0);
    const server = app.getHttpServer() as unknown as import('net').Server;
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 180_000);

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.removeAllListeners();
      socket.disconnect();
    }
  });

  afterAll(async () => {
    await app?.close();
    await pg?.container.stop();
    await mongo?.server.stop();
    await redis?.container.stop();
  });

  it('pushes planning.completed to the submitting client in real time, without polling', async () => {
    const token = await registerAndLogin('ws-happy@example.com');
    const socket = await connectClient(token);
    await waitForReady(socket);

    const completedPromise = waitForEvent<{
      jobId: string;
      status: string;
      result: unknown;
    }>(socket, 'planning.completed');

    const submitRes = await request(app.getHttpServer())
      .post('/planning-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'Draft an outline via WebSocket' })
      .expect(202);
    const jobId = submitRes.body.job_id as string;

    const event = await completedPromise;

    expect(event.jobId).toBe(jobId);
    expect(event.status).toBe('completed');
    expect(event.result).toEqual({
      suggestions: ['(stub plan) Draft an outline via WebSocket'],
      outline: null,
      sources: [],
    });
  }, 30_000);

  it('disconnects a socket that never presents a token', async () => {
    const socket = await connectClient(undefined);
    await waitForDisconnect(socket);
    expect(socket.connected).toBe(false);
  }, 15_000);

  it('disconnects a socket presenting an invalid/garbage JWT', async () => {
    const socket = await connectClient('not-a-real-jwt');
    await waitForDisconnect(socket);
    expect(socket.connected).toBe(false);
  }, 15_000);

  it("does not deliver user A's job events to user B's socket", async () => {
    const tokenA = await registerAndLogin('ws-user-a@example.com');
    const tokenB = await registerAndLogin('ws-user-b@example.com');

    const socketA = await connectClient(tokenA);
    const socketB = await connectClient(tokenB);
    await Promise.all([waitForReady(socketA), waitForReady(socketB)]);

    const receivedByB: unknown[] = [];
    socketB.on('planning.status', (payload) => receivedByB.push(payload));
    socketB.on('planning.completed', (payload) => receivedByB.push(payload));
    socketB.on('planning.failed', (payload) => receivedByB.push(payload));

    const completedPromiseA = waitForEvent<{ jobId: string }>(
      socketA,
      'planning.completed',
    );

    const submitRes = await request(app.getHttpServer())
      .post('/planning-jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ prompt: "User A's private prompt" })
      .expect(202);
    const jobId = submitRes.body.job_id as string;

    const eventA = await completedPromiseA;
    expect(eventA.jobId).toBe(jobId);

    // Give any (incorrect) cross-delivery a chance to arrive before
    // asserting its absence.
    await settle();
    expect(receivedByB).toHaveLength(0);
  }, 30_000);

  it('replays the current (completed) state on late-subscribe / reconnect', async () => {
    const token = await registerAndLogin('ws-catchup@example.com');

    const submitRes = await request(app.getHttpServer())
      .post('/planning-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'Finish before anyone subscribes' })
      .expect(202);
    const jobId = submitRes.body.job_id as string;

    // Let the job finish via the durable (Mongo) path before any socket
    // ever connects for it — this is the "reconnect after completion"
    // window the delivery contract calls out.
    const finalState = await pollUntilTerminal(jobId, token);
    expect(finalState.status).toBe('completed');

    const socket = await connectClient(token);
    await waitForReady(socket);

    const completedPromise = waitForEvent<{
      jobId: string;
      status: string;
      result: unknown;
    }>(socket, 'planning.completed');
    socket.emit('subscribe', { jobId });

    const event = await completedPromise;
    expect(event.jobId).toBe(jobId);
    expect(event.status).toBe('completed');
    expect(event.result).toEqual(finalState.result);
  }, 30_000);
});
