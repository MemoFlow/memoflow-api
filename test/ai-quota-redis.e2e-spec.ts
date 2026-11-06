import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  AiQuotaExceededError,
  AiQuotaUnavailableError,
} from './../src/domain/ai/ai-quota.errors';
import {
  globalQuotaKey,
  RedisAiQuota,
  secondsUntilUtcMidnight,
  userQuotaKey,
  utcDay,
} from './../src/infrastructure/ai/redis-ai-quota';
import { describeWithDocker } from './utils/pg-testcontainer';
import { startRedisContainer, RedisTestEnv } from './utils/redis-testcontainer';
import { stopContainer } from './utils/stop-container';

// Real time: Redis applies the expiry against its own clock, so the keys must
// be for the real UTC day. Only the rollover test moves the clock, forward.
const DAY = utcDay(new Date());

function configFor(port: number, values: Record<string, unknown> = {}): never {
  const all: Record<string, unknown> = {
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: port,
    ...values,
  };
  return {
    getOrThrow: (key: string) => all[key],
    get: (key: string) => all[key],
  } as never;
}

type Outcome = 'ok' | 'exceeded' | 'unavailable';

async function outcome(call: Promise<void>): Promise<Outcome> {
  try {
    await call;
    return 'ok';
  } catch (err) {
    if (err instanceof AiQuotaExceededError) return 'exceeded';
    if (err instanceof AiQuotaUnavailableError) return 'unavailable';
    throw err;
  }
}

/**
 * The quota's Lua script against a real Redis: atomicity cannot be shown with
 * a mock. Needs only Docker for the Redis container.
 */
describeWithDocker()('AI quota Lua script on real Redis (e2e)', () => {
  let redis: RedisTestEnv;
  let raw: Redis;
  let port: number;
  let quota: RedisAiQuota;

  beforeAll(async () => {
    redis = await startRedisContainer();
    port = Number(redis.env.REDIS_PORT);
    raw = new Redis({ host: redis.env.REDIS_HOST, port });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  }, 120_000);

  afterAll(async () => {
    await raw?.quit().catch(() => undefined);
    await stopContainer(redis?.container);
  });

  beforeEach(async () => {
    await raw.flushall();
    quota = new RedisAiQuota(
      configFor(port, {
        REDIS_HOST: redis.env.REDIS_HOST,
        AI_USER_DAILY_LIMIT: 5,
        AI_GLOBAL_DAILY_LIMIT: 8,
      }),
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await quota.onModuleDestroy();
  });

  const count = async (key: string) => Number((await raw.get(key)) ?? 0);

  it('never lets concurrent reserves exceed the per-user limit', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => outcome(quota.reserve('only-user'))),
    );

    expect(results.filter((r) => r === 'ok')).toHaveLength(5);
    expect(results.filter((r) => r === 'exceeded')).toHaveLength(35);
    expect(await count(userQuotaKey('only-user', DAY))).toBe(5);
    expect(await count(globalQuotaKey(DAY))).toBe(5);
  });

  it('never lets concurrent reserves by many users exceed the global limit or any user limit', async () => {
    const users = ['u1', 'u2', 'u3', 'u4'];
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        outcome(quota.reserve(users[i % users.length])),
      ),
    );

    expect(results.filter((r) => r === 'ok')).toHaveLength(8);
    expect(await count(globalQuotaKey(DAY))).toBe(8);
    let perUserTotal = 0;
    for (const user of users) {
      const used = await count(userQuotaKey(user, DAY));
      expect(used).toBeLessThanOrEqual(5);
      perUserTotal += used;
    }
    expect(perUserTotal).toBe(8);
  });

  it('a rejection increments neither counter', async () => {
    for (let i = 0; i < 5; i += 1) await quota.reserve('a');
    // 'a' is at its limit; the global counter (5 of 8) has room.
    expect(await outcome(quota.reserve('a'))).toBe('exceeded');
    expect(await count(userQuotaKey('a', DAY))).toBe(5);
    expect(await count(globalQuotaKey(DAY))).toBe(5);

    for (let i = 0; i < 3; i += 1) await quota.reserve('b');
    // Global is now spent, 'c' has used nothing.
    expect(await outcome(quota.reserve('c'))).toBe('exceeded');
    expect(await count(userQuotaKey('c', DAY))).toBe(0);
    expect(await count(globalQuotaKey(DAY))).toBe(8);
  });

  it('check counts nothing, and agrees with reserve', async () => {
    expect(await outcome(quota.check('a'))).toBe('ok');
    expect(await count(userQuotaKey('a', DAY))).toBe(0);
    expect(await count(globalQuotaKey(DAY))).toBe(0);

    for (let i = 0; i < 5; i += 1) await quota.reserve('a');
    expect(await outcome(quota.check('a'))).toBe('exceeded');
    expect(await count(userQuotaKey('a', DAY))).toBe(5);
  });

  it('a limit of 0 refuses everything', async () => {
    const closed = new RedisAiQuota(
      configFor(port, {
        REDIS_HOST: redis.env.REDIS_HOST,
        AI_USER_DAILY_LIMIT: 0,
      }),
    );
    try {
      expect(await outcome(closed.reserve('a'))).toBe('exceeded');
      expect(await outcome(closed.check('a'))).toBe('exceeded');
    } finally {
      await closed.onModuleDestroy();
    }
  });

  it("starts fresh at UTC midnight and expires each day's keys shortly after it", async () => {
    for (let i = 0; i < 5; i += 1) await quota.reserve('a');
    expect(await outcome(quota.reserve('a'))).toBe('exceeded');

    const ttl = await raw.ttl(userQuotaKey('a', DAY));
    const untilMidnight = secondsUntilUtcMidnight(new Date());
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeGreaterThanOrEqual(untilMidnight - 5);
    expect(ttl).toBeLessThanOrEqual(untilMidnight + 3600);
    expect(await raw.ttl(globalQuotaKey(DAY))).toBeGreaterThan(0);

    const tomorrow = utcDay(new Date(Date.now() + 86_400_000));
    const nextMidnight =
      Date.now() + secondsUntilUtcMidnight(new Date()) * 1000 + 1000;
    jest.spyOn(Date, 'now').mockReturnValue(nextMidnight);
    expect(await outcome(quota.reserve('a'))).toBe('ok');
    expect(await count(userQuotaKey('a', tomorrow))).toBe(1);
    expect(await count(userQuotaKey('a', DAY))).toBe(5);
  });

  it('Retry-After is the seconds left in the UTC day', async () => {
    for (let i = 0; i < 5; i += 1) await quota.reserve('a');

    const err = await quota.reserve('a').catch((e: unknown) => e);

    const expected = secondsUntilUtcMidnight(new Date());
    expect(
      Math.abs((err as AiQuotaExceededError).retryAfterSeconds - expected),
    ).toBeLessThanOrEqual(2);
  });

  it('fails closed when Redis cannot be reached', async () => {
    const unreachable = new RedisAiQuota(configFor(1));
    try {
      expect(await outcome(unreachable.reserve('a'))).toBe('unavailable');
      expect(await outcome(unreachable.check('a'))).toBe('unavailable');
    } finally {
      await unreachable.onModuleDestroy();
    }
  });
});
