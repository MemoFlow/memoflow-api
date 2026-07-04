import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Redis } from 'ioredis';

/**
 * Custom Terminus-style Redis health indicator (BullMQ's queue connection
 * is a hard dependency — see docker-compose.yml / ARCHITECTURE.md). Owns a
 * dedicated ioredis client rather than reaching into BullMQ's connection so
 * this module has no dependency on the queue module.
 */
@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    config: ConfigService,
  ) {
    this.client = new Redis({
      host: config.getOrThrow<string>('REDIS_HOST'),
      port: config.getOrThrow<number>('REDIS_PORT'),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      // Strict TLS on purpose (verify Upstash's signed cert) — see the note
      // in queue.module.ts on why this diverges from POSTGRES_SSL.
      ...(config.get<boolean>('REDIS_TLS') ? { tls: {} } : {}),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // Health-check client, not an operational connection: stop reconnecting
      // after a few attempts so a Redis outage doesn't spin forever. Each
      // pingCheck() lazily reconnects, so bounding retries here is safe.
      retryStrategy: (times: number) =>
        times > 5 ? null : Math.min(times * 50, 2000),
    });
    // Without an 'error' listener ioredis logs every reconnect failure to the
    // console while Redis is down. The real error already surfaces through the
    // ping() rejection we catch in pingCheck(), so swallow the noise here.
    this.client.on('error', () => undefined);
  }

  async pingCheck(
    key: string,
    options: { timeout?: number } = {},
  ): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const timeout = options.timeout ?? 3000;

    try {
      await this.withTimeout(this.client.ping(), timeout);
      return indicator.up();
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : 'Redis ping failed',
      });
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Redis health check timed out')),
        ms,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async onModuleDestroy(): Promise<void> {
    // "close" (graceful) — never throws even if the client never connected.
    await this.client.quit().catch(() => undefined);
  }
}
