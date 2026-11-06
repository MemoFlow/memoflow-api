import { Logger } from '@nestjs/common';
import {
  AiQuotaExceededError,
  AiQuotaUnavailableError,
} from '../../domain/ai/ai-quota.errors';
import {
  globalQuotaKey,
  QUOTA_SCRIPT,
  RedisAiQuota,
  secondsUntilUtcMidnight,
  userQuotaKey,
  utcDay,
} from './redis-ai-quota';

const mockClient = {
  eval: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
  on: jest.fn(),
};

jest.mock('ioredis', () => ({ Redis: jest.fn(() => mockClient) }));

function makeConfig(values: Record<string, unknown> = {}) {
  const all: Record<string, unknown> = {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    ...values,
  };
  return {
    getOrThrow: (key: string) => all[key],
    get: (key: string) => all[key],
  } as never;
}

describe('RedisAiQuota', () => {
  beforeEach(() => {
    mockClient.eval.mockReset().mockResolvedValue(1);
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  const at = (iso: string) =>
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso));

  it('reserves with hashed-user and global keys for the UTC day, both limits and an expiry just after midnight', async () => {
    at('2026-11-06T22:00:00.000Z');
    const quota = new RedisAiQuota(
      makeConfig({ AI_USER_DAILY_LIMIT: 3, AI_GLOBAL_DAILY_LIMIT: 7 }),
    );

    await quota.reserve('user-1');

    const args = mockClient.eval.mock.calls[0] as unknown[];
    expect(args[0]).toBe(QUOTA_SCRIPT);
    expect(args[1]).toBe(2);
    expect(args[2]).toBe(userQuotaKey('user-1', '2026-11-06'));
    expect(args[3]).toBe('ai-quota:global:2026-11-06');
    expect(args[4]).toBe('3');
    expect(args[5]).toBe('7');
    // Midnight is two hours away; the expiry sits a grace period after it.
    const midnight = Date.parse('2026-11-07T00:00:00.000Z') / 1000;
    expect(Number(args[6])).toBeGreaterThan(midnight);
    expect(Number(args[6])).toBeLessThanOrEqual(midnight + 3600);
    expect(args[7]).toBe('reserve');
    expect(String(args[2])).not.toContain('user-1');
  });

  it('defaults to 10 per user and 40 in total', async () => {
    const quota = new RedisAiQuota(makeConfig());

    await quota.reserve('user-1');

    const args = mockClient.eval.mock.calls[0] as unknown[];
    expect(args[4]).toBe('10');
    expect(args[5]).toBe('40');
  });

  it('check uses the script in read-only mode', async () => {
    const quota = new RedisAiQuota(makeConfig());

    await quota.check('user-1');

    expect((mockClient.eval.mock.calls[0] as unknown[])[7]).toBe('check');
  });

  it('throws AiQuotaExceededError with seconds to the next UTC midnight when the script rejects', async () => {
    at('2026-11-06T23:00:00.000Z');
    mockClient.eval.mockResolvedValue(0);
    const quota = new RedisAiQuota(makeConfig());

    const err = await quota.reserve('user-1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiQuotaExceededError);
    expect((err as AiQuotaExceededError).retryAfterSeconds).toBe(3600);
    expect((err as Error).message).toBe(
      'Daily AI usage limit reached. Try again later.',
    );
  });

  it('uses a new key after UTC midnight', async () => {
    const quota = new RedisAiQuota(makeConfig());
    at('2026-11-06T23:59:59.000Z');
    await quota.reserve('user-1');
    at('2026-11-07T00:00:00.000Z');
    await quota.reserve('user-1');

    const [first, second] = mockClient.eval.mock.calls as unknown[][];
    expect(first[2]).toBe(userQuotaKey('user-1', '2026-11-06'));
    expect(second[2]).toBe(userQuotaKey('user-1', '2026-11-07'));
    expect(first[3]).not.toBe(second[3]);
  });

  it.each([['reserve' as const], ['check' as const]])(
    'fails closed on a Redis error during %s, without leaking the cause',
    async (mode) => {
      mockClient.eval.mockRejectedValue(
        new Error('connect ECONNREFUSED 10.0.0.5'),
      );
      const quota = new RedisAiQuota(makeConfig());

      const err = await quota[mode]('user-1').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AiQuotaUnavailableError);
      expect((err as Error).message).not.toContain('10.0.0.5');
    },
  );

  it('closes its connection on shutdown', async () => {
    await new RedisAiQuota(makeConfig()).onModuleDestroy();
    expect(mockClient.quit).toHaveBeenCalled();
  });
});

describe('quota key helpers', () => {
  it('formats the UTC day', () => {
    expect(utcDay(new Date('2026-01-02T23:59:59.999Z'))).toBe('2026-01-02');
  });

  it('counts seconds to the next UTC midnight, never below 1', () => {
    expect(secondsUntilUtcMidnight(new Date('2026-11-06T00:00:00.000Z'))).toBe(
      86_400,
    );
    expect(secondsUntilUtcMidnight(new Date('2026-11-06T23:59:59.500Z'))).toBe(
      1,
    );
    expect(secondsUntilUtcMidnight(new Date('2026-12-31T23:59:59.999Z'))).toBe(
      1,
    );
  });

  it('hashes the user id and keeps users apart', () => {
    expect(userQuotaKey('a', '2026-11-06')).not.toBe(
      userQuotaKey('b', '2026-11-06'),
    );
    expect(userQuotaKey('a', '2026-11-06')).toMatch(
      /^ai-quota:user:[0-9a-f]{64}:2026-11-06$/,
    );
    expect(globalQuotaKey('2026-11-06')).toBe('ai-quota:global:2026-11-06');
  });
});
