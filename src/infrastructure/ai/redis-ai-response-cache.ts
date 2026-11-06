import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import {
  AiResponseCache,
  CachedSuggestion,
} from '../../domain/ai/ai-response-cache.port';
import { createAiRedisClient } from './ai-redis-client';

export const DEFAULT_AI_CACHE_TTL_SECONDS = 86_400;

const KEY_PREFIX = 'ai-cache:suggestion:';

/**
 * Redis-backed `AiResponseCache`. The key is an opaque digest (see
 * `suggestion-cache-key.ts`); the value is the validated output as JSON.
 * Fails open: every error behaves as a miss and only the error name is
 * logged. A TTL of 0 disables the cache entirely.
 */
@Injectable()
export class RedisAiResponseCache implements AiResponseCache, OnModuleDestroy {
  private readonly logger = new Logger(RedisAiResponseCache.name);
  private readonly client: Redis;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService) {
    this.client = createAiRedisClient(config);
    this.ttlSeconds =
      config.get<number>('AI_CACHE_TTL_SECONDS') ??
      DEFAULT_AI_CACHE_TTL_SECONDS;
  }

  async get(key: string): Promise<CachedSuggestion | null> {
    if (this.ttlSeconds <= 0) return null;
    try {
      const raw = await this.client.get(KEY_PREFIX + key);
      return raw === null ? null : parseEntry(raw);
    } catch (err) {
      this.warn('get', err);
      return null;
    }
  }

  async set(key: string, value: CachedSuggestion): Promise<void> {
    if (this.ttlSeconds <= 0) return;
    try {
      await this.client.set(
        KEY_PREFIX + key,
        JSON.stringify({
          suggestedText: value.suggestedText,
          model: value.model,
        }),
        'EX',
        this.ttlSeconds,
      );
    } catch (err) {
      this.warn('set', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  private warn(op: string, err: unknown): void {
    this.logger.warn(
      `AI response cache unavailable during ${op}; treating as a miss (${
        err instanceof Error ? err.name : 'unknown'
      })`,
    );
  }
}

/** A well-formed entry or `null`: a corrupt value is just a miss. */
function parseEntry(raw: string): CachedSuggestion | null {
  try {
    const value = JSON.parse(raw) as {
      suggestedText?: unknown;
      model?: unknown;
    } | null;
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.suggestedText !== 'string' ||
      (value.model !== null && typeof value.model !== 'string')
    ) {
      return null;
    }
    return { suggestedText: value.suggestedText, model: value.model };
  } catch {
    return null;
  }
}
