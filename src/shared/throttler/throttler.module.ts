import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

/**
 * Global request rate limiting. Registers a default throttle for every route
 * (overridable per-route with `@Throttle` — see the tighter caps on the auth
 * and AI endpoints) and installs `ThrottlerGuard` as an `APP_GUARD` so it runs
 * on all requests. `THROTTLE_TTL` (window, milliseconds) and `THROTTLE_LIMIT`
 * (requests/window) are optional env overrides.
 *
 * Storage is the throttler's default in-memory store, deliberately NOT a
 * Redis-backed store: the global guard runs on every request, so a Redis-
 * backed store would make Redis a hard per-request dependency and turn a Redis
 * blip into a full API outage — whereas this app otherwise treats Redis as a
 * lazy, non-critical-path dependency (BullMQ). The cost is that counters are
 * per-instance rather than shared; acceptable for the current single-instance
 * deployment. Shared (Redis) storage is a future enhancement for horizontal
 * scaling, and only worth doing if the store is made fail-open so a Redis
 * outage can't take the whole API down.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL') ?? 60_000,
            limit: config.get<number>('THROTTLE_LIMIT') ?? 100,
          },
        ],
        // Disabled under `NODE_ENV=test`: the e2e suites fire many requests
        // from a single client IP and would otherwise trip the limit. Active
        // in development/staging/production.
        skipIf: () => config.get<string>('NODE_ENV') === 'test',
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppThrottlerModule {}
