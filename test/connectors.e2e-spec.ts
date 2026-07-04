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

// Booting AppModule requires a live PostgreSQL (TypeORM connects at init),
// which Testcontainers can only provide when a Docker daemon is present.
// The real Composio gateway is swapped for a fake below — this suite never
// makes a network call to Composio.
describeWithDocker()('Connectors (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;

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

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    Object.assign(process.env, pg.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
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

    // Import late so ConfigModule validation sees the test env vars, and so
    // these domain imports resolve against the same module instances the
    // app boots with.
    const { AppModule } = await import('./../src/app.module');
    const { CONNECTOR_GATEWAY } =
      await import('./../src/domain/connectors/connector-gateway.port');
    const { ConnectorStatus } =
      await import('./../src/domain/connectors/connector-status');

    let nextAccountId = 1;
    const fakeGateway = {
      initiateConnection: () => {
        const composioAccountId = `ca_fake_${nextAccountId++}`;
        return Promise.resolve({
          redirectUrl: `https://composio.dev/connect/${composioAccountId}`,
          composioAccountId,
          status: ConnectorStatus.Initiated,
        });
      },
      getConnectionStatus: () => Promise.resolve(ConnectorStatus.Initiated),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CONNECTOR_GATEWAY)
      .useValue(fakeGateway)
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
    await pg?.container.stop();
    await mongo?.server.stop();
  });

  it('POST /connectors/:provider/connect requires a token (401 without one)', async () => {
    await request(app.getHttpServer())
      .post('/connectors/trello/connect')
      .expect(401);
  });

  it('POST /connectors/:provider/connect rejects an unknown provider with 400', async () => {
    const token = await registerAndLogin('bad-provider@example.com');

    await request(app.getHttpServer())
      .post('/connectors/not-a-real-provider/connect')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('POST /connectors/:provider/connect returns a redirect url, connection id, and status', async () => {
    const token = await registerAndLogin('connector@example.com');

    const res = await request(app.getHttpServer())
      .post('/connectors/trello/connect')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(res.body).toEqual({
      redirect_url: expect.stringContaining('https://composio.dev/connect/'),
      connection_id: expect.any(String),
      status: 'initiated',
    });
    // No token/secret/internal Composio reference ever leaks into the
    // response body.
    expect(res.body).not.toHaveProperty('composioAccountId');
    expect(res.body).not.toHaveProperty('accessToken');
    expect(res.body).not.toHaveProperty('refreshToken');
  });

  it('GET /connectors lists the connections created by the current user only', async () => {
    const token = await registerAndLogin('lister@example.com');
    const otherToken = await registerAndLogin('other-lister@example.com');

    await request(app.getHttpServer())
      .post('/connectors/trello/connect')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/connectors/notion/connect')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/connectors')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      provider: 'trello',
      status: 'initiated',
    });
    expect(res.body[0]).not.toHaveProperty('composioAccountId');
  });

  it('GET /connectors/:id returns the connection when owned by the current user', async () => {
    const token = await registerAndLogin('getter@example.com');

    const connectRes = await request(app.getHttpServer())
      .post('/connectors/github/connect')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const connectionId = connectRes.body.connection_id as string;

    const res = await request(app.getHttpServer())
      .get(`/connectors/${connectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({
      id: connectionId,
      provider: 'github',
      status: 'initiated',
    });
  });

  it('GET /connectors/:id returns 400 for a non-uuid id', async () => {
    const token = await registerAndLogin('bad-id@example.com');

    await request(app.getHttpServer())
      .get('/connectors/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /connectors/:id returns 404 for an unknown (but valid) uuid', async () => {
    const token = await registerAndLogin('unknown-id@example.com');

    await request(app.getHttpServer())
      .get('/connectors/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("returns 404 (not another user's data) when requesting someone else's connection", async () => {
    const ownerToken = await registerAndLogin('owner-connector@example.com');
    const connectRes = await request(app.getHttpServer())
      .post('/connectors/trello/connect')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    const connectionId = connectRes.body.connection_id as string;

    const otherToken = await registerAndLogin(
      'someone-else-connector@example.com',
    );

    await request(app.getHttpServer())
      .get(`/connectors/${connectionId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('reconnecting the same provider overwrites the previous row rather than creating a second one', async () => {
    const token = await registerAndLogin('reconnect@example.com');

    const first = await request(app.getHttpServer())
      .post('/connectors/notion/connect')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/connectors/notion/connect')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(second.body.connection_id).toBe(first.body.connection_id);

    const listRes = await request(app.getHttpServer())
      .get('/connectors')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const notionRows = listRes.body.filter(
      (row: { provider: string }) => row.provider === 'notion',
    );
    expect(notionRows).toHaveLength(1);
  });
});
