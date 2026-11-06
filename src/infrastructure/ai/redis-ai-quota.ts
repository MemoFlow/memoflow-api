import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import {
  AiQuotaExceededError,
  AiQuotaUnavailableError,
} from '../../domain/ai/ai-quota.errors';
import { AiQuota } from '../../domain/ai/ai-quota.port';
import { createAiRedisClient } from './ai-redis-client';

export const DEFAULT_AI_USER_DAILY_LIMIT = 10;
export const DEFAULT_AI_GLOBAL_DAILY_LIMIT = 40;

/** How long a counter outlives its UTC day, so it is never cut short. */
const EXPIRY_GRACE_SECONDS = 3600;

/**
 * Atomic. Reads both counters first: if either is at its limit, rejects and
 * increments nothing. Otherwise (mode `reserve`) increments both and sets the
 * absolute expiry. Mode `check` stops after the reads and counts nothing.
 * Returns 1 when allowed, 0 when a limit is spent.
 *
 * KEYS: user counter, global counter.
 * ARGV: user limit, global limit, expiry (unix seconds), mode.
 */
export const QUOTA_SCRIPT = `
local userCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local globalCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if userCount >= tonumber(ARGV[1]) or globalCount >= tonumber(ARGV[2]) then
  return 0
end
if ARGV[4] == 'reserve' then
  redis.call('INCR', KEYS[1])
  redis.call('INCR', KEYS[2])
  redis.call('EXPIREAT', KEYS[1], ARGV[3])
  redis.call('EXPIREAT', KEYS[2], ARGV[3])
end
return 1
`;

/** `YYYY-MM-DD` in UTC. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Seconds from `at` to the next UTC midnight; never below 1. */
export function secondsUntilUtcMidnight(at: Date): number {
  const next = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - at.getTime()) / 1000));
}

export function userQuotaKey(userId: string, day: string): string {
  const hash = createHash('sha256').update(userId).digest('hex');
  return `ai-quota:user:${hash}:${day}`;
}

export function globalQuotaKey(day: string): string {
  return `ai-quota:global:${day}`;
}

/**
 * Redis-backed `AiQuota`: one counter per user and one global, per UTC day.
 * Keys hold a hash of the user id, never the id. Fails closed: any Redis error
 * becomes `AiQuotaUnavailableError`.
 */
@Injectable()
export class RedisAiQuota implements AiQuota, OnModuleDestroy {
  private readonly logger = new Logger(RedisAiQuota.name);
  private readonly client: Redis;
  private readonly userLimit: number;
  private readonly globalLimit: number;

  constructor(config: ConfigService) {
    this.client = createAiRedisClient(config);
    this.userLimit =
      config.get<number>('AI_USER_DAILY_LIMIT') ?? DEFAULT_AI_USER_DAILY_LIMIT;
    this.globalLimit =
      config.get<number>('AI_GLOBAL_DAILY_LIMIT') ??
      DEFAULT_AI_GLOBAL_DAILY_LIMIT;
  }

  reserve(userId: string): Promise<void> {
    return this.run(userId, 'reserve');
  }

  check(userId: string): Promise<void> {
    return this.run(userId, 'check');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  private async run(userId: string, mode: 'reserve' | 'check'): Promise<void> {
    const now = new Date(Date.now());
    const day = utcDay(now);
    const retryAfterSeconds = secondsUntilUtcMidnight(now);
    const expireAt =
      Math.floor(now.getTime() / 1000) +
      retryAfterSeconds +
      EXPIRY_GRACE_SECONDS;

    let allowed: unknown;
    try {
      allowed = await this.client.eval(
        QUOTA_SCRIPT,
        2,
        userQuotaKey(userId, day),
        globalQuotaKey(day),
        String(this.userLimit),
        String(this.globalLimit),
        String(expireAt),
        mode,
      );
    } catch (err) {
      // Name only: the message can carry the Redis address.
      this.logger.error(
        `AI quota unavailable during ${mode}; refusing (${
          err instanceof Error ? err.name : 'unknown'
        })`,
      );
      throw new AiQuotaUnavailableError();
    }
    if (allowed !== 1) {
      throw new AiQuotaExceededError(retryAfterSeconds);
    }
  }
}
