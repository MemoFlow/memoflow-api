import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  isDockerAvailable,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';

// Booting AppModule requires a live PostgreSQL (TypeORM connects at init),
// which Testcontainers can only provide when a Docker daemon is present.
// MongoDB comes from mongodb-memory-server and needs nothing external.
const dockerAvailable = isDockerAvailable();
const describeWithDocker = dockerAvailable ? describe : describe.skip;

describeWithDocker('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    Object.assign(process.env, pg.env, { MONGODB_URI: mongo.uri });

    // Import late so ConfigModule validation sees the test env vars.
    const { AppModule } = await import('./../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.container.stop();
    await mongo?.server.stop();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET) reports both databases up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const body = res.body as {
      status: string;
      details: Record<string, { status: string }>;
    };
    expect(body.status).toBe('ok');
    expect(body.details.postgres.status).toBe('up');
    expect(body.details.mongodb.status).toBe('up');
  });
});

if (!dockerAvailable) {
  it('e2e suite skipped: no Docker daemon available for Testcontainers', () => {
    expect(true).toBe(true);
  });
}
