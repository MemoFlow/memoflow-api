import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import {
  LOGIN_ATTEMPT_WINDOW_SECONDS,
  LOGIN_MAX_ATTEMPTS,
  LoginAttemptLimiter,
  LoginAttemptResult,
} from '../../domain/auth/login-attempt-limiter.port';

// Atomic: increment, start the window on the first attempt (or repair a key
// that somehow lost its expiry), and return the count with the remaining TTL.
const INCR_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

const KEY_PREFIX = 'login-attempts:';

export function loginAttemptKey(email: string): string {
  return KEY_PREFIX + createHash('sha256').update(email).digest('hex');
}

/**
 * Redis-backed `LoginAttemptLimiter`. Keys are SHA-256 digests of the
 * normalized email, so no address is stored. Fails open on any Redis error
 * (logging a warning without the email): the per-IP throttle still applies.
 */
@Injectable()
export class RedisLoginAttemptLimiter
  implements LoginAttemptLimiter, OnModuleDestroy
{
  private readonly logger = new Logger(RedisLoginAttemptLimiter.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis({
      host: config.getOrThrow<string>('REDIS_HOST'),
      port: config.getOrThrow<number>('REDIS_PORT'),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      // Same strict TLS as the queue and health connections.
      ...(config.get<boolean>('REDIS_TLS') ? { tls: {} } : {}),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // Fail fast: a slow Redis must not stall logins.
      commandTimeout: 1000,
      connectTimeout: 2000,
    });
    this.client.on('error', () => undefined);
  }

  async registerAttempt(email: string): Promise<LoginAttemptResult> {
    try {
      const [count, ttlMs] = (await this.client.eval(
        INCR_WITH_EXPIRY,
        1,
        loginAttemptKey(email),
        String(LOGIN_ATTEMPT_WINDOW_SECONDS * 1000),
      )) as [number, number];
      return {
        allowed: count <= LOGIN_MAX_ATTEMPTS,
        retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
      };
    } catch (err) {
      this.warn('registerAttempt', err);
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  async clear(email: string): Promise<void> {
    try {
      await this.client.del(loginAttemptKey(email));
    } catch (err) {
      this.warn('clear', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  private warn(op: string, err: unknown): void {
    const message = err instanceof Error ? err.message : 'unknown error';
    this.logger.warn(
      `Login attempt limiter unavailable during ${op}; allowing login: ${message}`,
    );
  }
}
