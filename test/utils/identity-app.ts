import type { AddressInfo } from 'node:net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { startMongoMemory, MongoTestEnv } from './mongo-memory';
import { startPgContainer, PgTestEnv } from './pg-testcontainer';
import { startRedisContainer, RedisTestEnv } from './redis-testcontainer';

export interface CapturedMail {
  to: string;
  subject: string;
  text: string;
}

/** Fake `EMAIL_SENDER` that captures messages instead of sending them. */
export class CapturingMailbox {
  readonly sent: CapturedMail[] = [];

  send(message: CapturedMail): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  to(address: string, subject?: string): CapturedMail[] {
    return this.sent.filter(
      (m) => m.to === address && (!subject || m.subject.includes(subject)),
    );
  }

  /** Raw token from the link in a message. */
  static tokenOf(mail: CapturedMail): string {
    const match = /#token=(\S+)/.exec(mail.text);
    if (!match) throw new Error('no token link in message');
    return match[1];
  }
}

export interface IdentityApp {
  app: INestApplication<App>;
  baseUrl: string;
  pg: PgTestEnv;
  mailbox: CapturingMailbox;
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<Array<Record<string, unknown>>>;
  stop: () => Promise<void>;
}

/**
 * Boots the full app against Testcontainers PG + Redis and in-memory Mongo,
 * with a capturing fake in place of the real email sender.
 */
export async function bootIdentityApp(
  extraEnv: Record<string, string> = {},
): Promise<IdentityApp> {
  const pg = await startPgContainer();
  const mongo: MongoTestEnv = await startMongoMemory();
  const redis: RedisTestEnv = await startRedisContainer();
  Object.assign(process.env, pg.env, redis.env, {
    MONGODB_URI: mongo.uri,
    JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars-long',
    JWT_EXPIRES_IN: '15m',
    COMPOSIO_API_KEY: 'test-only-composio-key',
    COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
    COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
    APP_BASE_URL: 'https://app.test',
    ...extraEnv,
  });

  const dataSourceModule =
    await import('./../../src/infrastructure/persistence/typeorm.data-source');
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

  const { AppModule } = await import('./../../src/app.module');
  const { EMAIL_SENDER } =
    await import('./../../src/domain/email/email-sender.port');
  const mailbox = new CapturingMailbox();
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(EMAIL_SENDER)
    .useValue(mailbox)
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.listen(0);
  const server = app.getHttpServer() as unknown as import('net').Server;
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const query = async (sql: string, params: unknown[] = []) => {
    const client = new Client({
      host: pg.env.POSTGRES_HOST,
      port: Number(pg.env.POSTGRES_PORT),
      user: pg.env.POSTGRES_USER,
      password: pg.env.POSTGRES_PASSWORD,
      database: pg.env.POSTGRES_DB,
    });
    await client.connect();
    try {
      const res = await client.query<Record<string, unknown>>(sql, params);
      return res.rows;
    } finally {
      await client.end();
    }
  };

  return {
    app,
    baseUrl,
    pg,
    mailbox,
    query,
    stop: async () => {
      await app.close();
      await pg.container.stop();
      await mongo.server.stop();
      await redis.container.stop();
    },
  };
}

export const PASSWORD = 'correct-horse-battery-staple';

export async function loginToken(
  app: INestApplication<App>,
  email: string,
  password = PASSWORD,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

/** Polls until `check` returns true (async listeners deliver mail off-request). */
export async function waitUntil(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waitUntil timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Gives off-request listeners time to run, for asserting nothing was sent. */
export function settle(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
