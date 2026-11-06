import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import { startRedisContainer, RedisTestEnv } from './utils/redis-testcontainer';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';
import { stopContainer } from './utils/stop-container';

// Booting AppModule requires a live PostgreSQL (TypeORM connects at init),
// which Testcontainers can only provide when a Docker daemon is present.
describeWithDocker()('Users + Auth (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;

  const registerPayload = {
    email: 'ada@example.com',
    password: 'correct-horse-battery-staple',
    display_name: 'Ada Lovelace',
  };

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
    await stopContainer(pg?.container);
    await mongo?.server.stop();
    await stopContainer(redis?.container);
  });

  it('POST /auth/register answers 202 with only a message, and the user can then log in', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(202);

    expect(res.body).toEqual({ message: expect.any(String) });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: registerPayload.email,
        password: registerPayload.password,
      })
      .expect(200);
    const meRes = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200);
    expect(meRes.body).toMatchObject({
      email: registerPayload.email,
      display_name: registerPayload.display_name,
      role: 'user',
      xp: 0,
      level: 1,
      email_verified: false,
    });
    expect(meRes.body.id).toEqual(expect.any(String));
    expect(meRes.body).not.toHaveProperty('password_hash');
    expect(meRes.body).not.toHaveProperty('passwordHash');
    expect(meRes.body).not.toHaveProperty('password');
    expect(JSON.stringify(meRes.body)).not.toContain('$2');
  });

  it('POST /auth/register answers an already-registered email exactly like a new one', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(202);

    expect(res.body).toEqual({ message: expect.any(String) });
  });

  it('POST /auth/login rejects bad credentials with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: registerPayload.email, password: 'wrong-password' })
      .expect(401);
  });

  it('POST /auth/login returns an access token for valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: registerPayload.email,
        password: registerPayload.password,
      })
      .expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('GET /users/me requires a token (401 without one)', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('GET /users/me returns the authenticated user with a valid token', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: registerPayload.email,
        password: registerPayload.password,
      })
      .expect(200);
    const token = loginRes.body.accessToken as string;

    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({ email: registerPayload.email });
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('GET /users/:id returns a user by id when authenticated', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: registerPayload.email,
        password: registerPayload.password,
      })
      .expect(200);
    const token = loginRes.body.accessToken as string;

    const meRes = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const userId = meRes.body.id as string;

    const res = await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({
      id: userId,
      email: registerPayload.email,
    });
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('GET /users/:id returns 404 for an unknown (but valid) uuid', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: registerPayload.email,
        password: registerPayload.password,
      })
      .expect(200);
    const token = loginRes.body.accessToken as string;

    await request(app.getHttpServer())
      .get('/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('GET /users/:id returns 400 for a non-uuid id', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: registerPayload.email,
        password: registerPayload.password,
      })
      .expect(200);
    const token = loginRes.body.accessToken as string;

    await request(app.getHttpServer())
      .get('/users/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  describe('logout', () => {
    const email = 'logout-user@example.com';
    const password = 'correct-horse-battery-staple';

    async function login(): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return res.body.accessToken as string;
    }

    it('POST /auth/logout answers 204 and the old token (and any sibling session) stops working', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, display_name: 'Logout User' })
        .expect(202);
      const token = await login();
      const otherSession = await login();
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${otherSession}`)
        .expect(401);

      // A fresh login works again.
      const fresh = await login();
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${fresh}`)
        .expect(200);
    });

    it('POST /auth/logout requires a token', async () => {
      await request(app.getHttpServer()).post('/auth/logout').expect(401);
    });
  });

  describe('per-account login throttle', () => {
    // Each test runs many bcrypt logins, which can pass Jest's 5s default under load.
    it('answers 429 with Retry-After on the 11th failed attempt, even with the right password', async () => {
      const email = `throttle-${Date.now()}@example.com`;
      const password = 'correct-horse-battery-staple';
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, display_name: 'Throttle' })
        .expect(202);

      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'wrong-password' })
          .expect(401);
      }
      const blocked = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(429);

      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(900);
      expect(blocked.body.statusCode).toBe(429);
      expect(blocked.body.error).toBe('Too Many Requests');
      expect(blocked.body.message).toBe(
        'Too many login attempts. Try again later.',
      );
    }, 30_000);

    it('throttles unknown emails the same way', async () => {
      const email = `ghost-${Date.now()}@example.com`;
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'whatever-password' })
          .expect(401);
      }
      const blocked = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'whatever-password' })
        .expect(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    }, 30_000);

    it('a successful login resets the counter', async () => {
      const email = `reset-${Date.now()}@example.com`;
      const password = 'correct-horse-battery-staple';
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, display_name: 'Reset' })
        .expect(202);

      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 9; i++) {
          await request(app.getHttpServer())
            .post('/auth/login')
            .send({ email, password: 'wrong-password' })
            .expect(401);
        }
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password })
          .expect(200);
      }
    }, 30_000);
  });

  describe('72-byte password cap', () => {
    // 40 characters, 80 bytes.
    const multibyte = 'é'.repeat(40);

    it('POST /auth/register rejects a multibyte password over 72 bytes with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'multibyte@example.com',
          password: multibyte,
          display_name: 'Multi',
        })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain('72 bytes');
    });

    it('POST /auth/reset-password rejects it too, before looking at the token', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'anything', new_password: multibyte })
        .expect(400)
        .expect((res) => {
          expect(JSON.stringify(res.body.message)).toContain('72 bytes');
        });
    });
  });
});
