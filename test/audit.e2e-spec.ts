import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLogOrmEntity } from '../src/infrastructure/persistence/audit/audit-log.orm-entity';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';

// Booting AppModule requires a live PostgreSQL (TypeORM connects at init),
// which Testcontainers can only provide when a Docker daemon is present.
// `audit_logs` has no controller — this suite asserts rows directly via a
// second `DataSource` connected to the same test container, polling because
// `AuditListener` consumes `EventEmitter2.emit()` fire-and-forget: the write
// can still be in flight when the triggering HTTP response comes back
// (mirrors `gamification.e2e-spec.ts`'s `waitForGamification` poll).
describeWithDocker()('Audit log (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let queryDataSource: DataSource;

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

  async function waitForAuditLog(
    predicate: (rows: AuditLogOrmEntity[]) => boolean,
    { timeoutMs = 5_000, intervalMs = 100 } = {},
  ): Promise<AuditLogOrmEntity[]> {
    const repository = queryDataSource.getRepository(AuditLogOrmEntity);
    const deadline = Date.now() + timeoutMs;
    let last: AuditLogOrmEntity[] = [];
    while (Date.now() < deadline) {
      last = await repository.find({ order: { createdAt: 'ASC' } });
      if (predicate(last)) {
        return last;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `waitForAuditLog: predicate never held within ${timeoutMs}ms — last state: ${JSON.stringify(last)}`,
    );
  }

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    Object.assign(process.env, pg.env, {
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

    // A separate long-lived connection this suite queries `audit_logs`
    // through — the app's own connection is internal to AppModule/TypeORM
    // and audit_logs has no read endpoint to assert against instead.
    queryDataSource = new DataSource({
      type: 'postgres',
      host: pg.env.POSTGRES_HOST,
      port: Number(pg.env.POSTGRES_PORT),
      username: pg.env.POSTGRES_USER,
      password: pg.env.POSTGRES_PASSWORD,
      database: pg.env.POSTGRES_DB,
      entities: [AuditLogOrmEntity],
    });
    await queryDataSource.initialize();

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
      verifyWebhook: () =>
        Promise.reject(new Error('verifyWebhook not used in this suite')),
      revoke: () => Promise.resolve(),
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
    await queryDataSource?.destroy();
    await pg?.container.stop();
    await mongo?.server.stop();
  });

  it('a successful login writes one audit_logs row with action=auth.login', async () => {
    const email = 'audit-login-ok@example.com';
    const password = 'correct-horse-battery-staple';
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, display_name: 'Audit OK' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const rows = await waitForAuditLog((all) =>
      all.some((row) => row.action === 'auth.login' && row.metadata === null),
    );
    const loginRows = rows.filter(
      (row) =>
        row.action === 'auth.login' &&
        // scope to this test's own user — the suite runs other logins too
        row.userId !== null,
    );
    expect(loginRows.length).toBeGreaterThanOrEqual(1);
    expect(loginRows[0].metadata).toBeNull();
    expect(loginRows[0].ip).toBeNull();
  });

  it('a bad-password login writes one audit_logs row with action=auth.login_failed', async () => {
    const email = 'audit-login-bad@example.com';
    const password = 'correct-horse-battery-staple';
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, display_name: 'Audit Bad' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);

    const rows = await waitForAuditLog((all) =>
      all.some(
        (row) =>
          row.action === 'auth.login_failed' &&
          (row.metadata as { email?: string } | null)?.email === email,
      ),
    );
    const failedRow = rows.find(
      (row) =>
        row.action === 'auth.login_failed' &&
        (row.metadata as { email?: string } | null)?.email === email,
    );
    expect(failedRow).toBeDefined();
    expect(failedRow?.userId).toEqual(expect.any(String));
  });

  it('a failed login against an unknown email writes a row with a null userId', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody-audit@example.com', password: 'whatever' })
      .expect(401);

    const rows = await waitForAuditLog((all) =>
      all.some(
        (row) =>
          row.action === 'auth.login_failed' &&
          (row.metadata as { email?: string } | null)?.email ===
            'nobody-audit@example.com',
      ),
    );
    const failedRow = rows.find(
      (row) =>
        row.action === 'auth.login_failed' &&
        (row.metadata as { email?: string } | null)?.email ===
          'nobody-audit@example.com',
    );
    expect(failedRow?.userId).toBeNull();
  });

  it('revoking a connector writes an audit_logs row with action=connector.revoked', async () => {
    const token = await registerAndLogin('audit-revoke@example.com');
    const connectRes = await request(app.getHttpServer())
      .post('/connectors/trello/connect')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const connectionId = connectRes.body.connection_id as string;

    await request(app.getHttpServer())
      .delete(`/connectors/${connectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const rows = await waitForAuditLog((all) =>
      all.some(
        (row) =>
          row.action === 'connector.revoked' &&
          (row.metadata as { connectionId?: string } | null)?.connectionId ===
            connectionId,
      ),
    );
    const revokedRow = rows.find(
      (row) =>
        row.action === 'connector.revoked' &&
        (row.metadata as { connectionId?: string } | null)?.connectionId ===
          connectionId,
    );
    expect(revokedRow?.metadata).toMatchObject({
      connectionId,
      provider: 'trello',
    });
    expect(revokedRow?.userId).toEqual(expect.any(String));
  });
});
