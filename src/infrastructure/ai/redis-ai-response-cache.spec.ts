import { Logger } from '@nestjs/common';
import { RedisAiResponseCache } from './redis-ai-response-cache';

const mockClient = {
  get: jest.fn(),
  set: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
  on: jest.fn(),
};

jest.mock('ioredis', () => ({ Redis: jest.fn(() => mockClient) }));

function makeCache(ttl?: number): RedisAiResponseCache {
  const all: Record<string, unknown> = {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    AI_CACHE_TTL_SECONDS: ttl,
  };
  return new RedisAiResponseCache({
    getOrThrow: (key: string) => all[key],
    get: (key: string) => all[key],
  } as never);
}

describe('RedisAiResponseCache', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockClient.get.mockReset();
    mockClient.set.mockReset().mockResolvedValue('OK');
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  it('stores the value as JSON under a prefixed key with the default one-day TTL', async () => {
    await makeCache().set('abc', { suggestedText: 'Hi', model: 'm' });

    expect(mockClient.set).toHaveBeenCalledWith(
      'ai-cache:suggestion:abc',
      '{"suggestedText":"Hi","model":"m"}',
      'EX',
      86_400,
    );
  });

  it('uses the configured TTL', async () => {
    await makeCache(30).set('abc', { suggestedText: 'Hi', model: null });

    expect((mockClient.set.mock.calls[0] as unknown[])[3]).toBe(30);
  });

  it('returns a stored entry, including a null model', async () => {
    mockClient.get.mockResolvedValue('{"suggestedText":"Hi","model":null}');

    await expect(makeCache().get('abc')).resolves.toEqual({
      suggestedText: 'Hi',
      model: null,
    });
    expect(mockClient.get).toHaveBeenCalledWith('ai-cache:suggestion:abc');
  });

  it('is a miss for nothing stored', async () => {
    mockClient.get.mockResolvedValue(null);
    await expect(makeCache().get('abc')).resolves.toBeNull();
  });

  it.each([
    ['not JSON', 'not json'],
    ['a JSON null', 'null'],
    ['a missing text', '{"model":"m"}'],
    ['a non-string text', '{"suggestedText":5,"model":"m"}'],
    ['a missing model', '{"suggestedText":"x"}'],
    ['a non-string model', '{"suggestedText":"x","model":5}'],
  ])('treats %s as a miss', async (_name, raw) => {
    mockClient.get.mockResolvedValue(raw);
    await expect(makeCache().get('abc')).resolves.toBeNull();
  });

  it('fails open: a read error is a miss and logs only the error name', async () => {
    mockClient.get.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5'));

    await expect(makeCache().get('abc')).resolves.toBeNull();

    const logged = warn.mock.calls.map((c: unknown[]) => String(c[0])).join();
    expect(logged).toContain('Error');
    expect(logged).not.toContain('10.0.0.5');
  });

  it('fails open: a write error is swallowed', async () => {
    mockClient.set.mockRejectedValue(new Error('boom'));

    await expect(
      makeCache().set('abc', { suggestedText: 'Hi', model: 'm' }),
    ).resolves.toBeUndefined();
  });

  it('is disabled by a TTL of 0: no reads, no writes', async () => {
    const cache = makeCache(0);

    await cache.set('abc', { suggestedText: 'Hi', model: 'm' });
    await expect(cache.get('abc')).resolves.toBeNull();

    expect(mockClient.get).not.toHaveBeenCalled();
    expect(mockClient.set).not.toHaveBeenCalled();
  });
});
