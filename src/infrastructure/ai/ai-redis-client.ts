import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Redis connection for the AI quota and response cache. Same host, auth and
 * strict TLS as the login limiter, queue and health connections. Fails fast
 * so a slow Redis cannot stall requests for long.
 */
export function createAiRedisClient(config: ConfigService): Redis {
  const client = new Redis({
    host: config.getOrThrow<string>('REDIS_HOST'),
    port: config.getOrThrow<number>('REDIS_PORT'),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    ...(config.get<boolean>('REDIS_TLS') ? { tls: {} } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    commandTimeout: 1000,
    connectTimeout: 2000,
  });
  client.on('error', () => undefined);
  return client;
}
