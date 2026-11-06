import { Logger } from '@nestjs/common';
import {
  LOGIN_ATTEMPT_WINDOW_SECONDS,
  LOGIN_MAX_ATTEMPTS,
} from '../../domain/auth/login-attempt-limiter.port';
import {
  RedisLoginAttemptLimiter,
  loginAttemptKey,
} from './redis-login-attempt-limiter';

// In-memory stand-in for the ioredis client. Only `eval`, `del`, `quit` and
// `on` are provided: if the limiter reached for a non-atomic INCR followed
// by EXPIRE it would throw "is not a function".
const mockClient = {
  store: new Map<string, { count: number; expiresAt: number }>(),
  evalCalls: [] as Array<{ script: string; args: unknown[] }>,
  fail: false,
  eval: jest.fn(),
  del: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
  on: jest.fn(),
};

jest.mock('ioredis', () => ({ Redis: jest.fn(() => mockClient) }));

const config = {
  getOrThrow: (key: string) => (key === 'REDIS_PORT' ? 6379 : 'localhost'),
  get: () => undefined,
};

describe('RedisLoginAttemptLimiter', () => {
  let limiter: RedisLoginAttemptLimiter;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockClient.store.clear();
    mockClient.evalCalls = [];
    mockClient.fail = false;
    mockClient.eval.mockReset();
    mockClient.del.mockReset();
    // Mirrors the Lua script: INCR, set expiry on first hit, return count+PTTL.
    mockClient.eval.mockImplementation(
      (script: string, _n: number, key: string, windowMs: string) => {
        mockClient.evalCalls.push({ script, args: [key, windowMs] });
        if (mockClient.fail) return Promise.reject(new Error('ECONNREFUSED'));
        let entry = mockClient.store.get(key);
        if (!entry || entry.expiresAt <= now) {
          entry = { count: 0, expiresAt: now + Number(windowMs) };
        }
        entry.count += 1;
        mockClient.store.set(key, entry);
        return Promise.resolve([entry.count, entry.expiresAt - now]);
      },
    );
    mockClient.del.mockImplementation((key: string) => {
      if (mockClient.fail) return Promise.reject(new Error('ECONNREFUSED'));
      mockClient.store.delete(key);
      return Promise.resolve(1);
    });
    limiter = new RedisLoginAttemptLimiter(config as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows the first 10 attempts and blocks the 11th', async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect((await limiter.registerAttempt('a@b.com')).allowed).toBe(true);
    }
    const blocked = await limiter.registerAttempt('a@b.com');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(LOGIN_ATTEMPT_WINDOW_SECONDS);
  });

  it('uses one atomic script (INCR + PEXPIRE) per attempt', async () => {
    await limiter.registerAttempt('a@b.com');

    expect(mockClient.eval).toHaveBeenCalledTimes(1);
    const { script, args } = mockClient.evalCalls[0];
    expect(script).toContain("redis.call('INCR'");
    expect(script).toContain("redis.call('PEXPIRE'");
    expect(args[1]).toBe(String(LOGIN_ATTEMPT_WINDOW_SECONDS * 1000));
  });

  it('keys on a SHA-256 digest, never the address', async () => {
    await limiter.registerAttempt('a@b.com');

    const key = mockClient.evalCalls[0].args[0] as string;
    expect(key).toBe(loginAttemptKey('a@b.com'));
    expect(key).toMatch(/^login-attempts:[0-9a-f]{64}$/);
    expect(key).not.toContain('a@b.com');
  });

  it('counts each address separately', async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS + 1; i++) {
      await limiter.registerAttempt('a@b.com');
    }
    expect((await limiter.registerAttempt('c@d.com')).allowed).toBe(true);
  });

  it('reports the remaining window as Retry-After and resets after expiry', async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      await limiter.registerAttempt('a@b.com');
    }
    now += 600_000; // 10 minutes in
    const blocked = await limiter.registerAttempt('a@b.com');
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 300 });

    now += LOGIN_ATTEMPT_WINDOW_SECONDS * 1000; // window over
    expect((await limiter.registerAttempt('a@b.com')).allowed).toBe(true);
  });

  it('clear() forgets the counter', async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS + 1; i++) {
      await limiter.registerAttempt('a@b.com');
    }
    await limiter.clear('a@b.com');
    expect((await limiter.registerAttempt('a@b.com')).allowed).toBe(true);
  });

  describe('fail open', () => {
    it('allows the attempt and warns without the email when Redis errors', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      mockClient.fail = true;

      const result = await limiter.registerAttempt('secret@example.com');

      expect(result.allowed).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toContain('secret@example.com');
    });

    it('swallows clear() errors', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mockClient.fail = true;

      await expect(limiter.clear('a@b.com')).resolves.toBeUndefined();
    });
  });

  it('closes the connection on module destroy', async () => {
    await limiter.onModuleDestroy();
    expect(mockClient.quit).toHaveBeenCalled();
  });
});
