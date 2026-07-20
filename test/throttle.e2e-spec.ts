import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';

// The real `AppThrottlerModule` disables throttling under NODE_ENV=test (so the
// other e2e suites, which fire many requests from one IP, aren't tripped). This
// spec therefore exercises the throttling mechanism directly with a minimal
// module that mirrors the production wiring — global ThrottlerGuard via
// APP_GUARD — but with a tiny limit and no test-env skip, proving the 429 path
// works in the Nest runtime. Needs no external containers.
@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 2 }] }),
  ],
  controllers: [PingController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class ThrottleTestModule {}

describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottleTestModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests up to the limit then returns 429', async () => {
    const server = app.getHttpServer();
    await request(server).get('/ping').expect(200);
    await request(server).get('/ping').expect(200);
    // Third request within the same window exceeds limit=2.
    await request(server).get('/ping').expect(429);
  });
});
