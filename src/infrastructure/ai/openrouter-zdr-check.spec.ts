import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FetchFn, OpenRouterZdrCheck } from './openrouter-zdr-check';

function config(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const BASE = {
  OPENROUTER_API_KEY: 'sk-or-secret',
  OPENROUTER_REQUIRE_ZDR: true,
  OPENROUTER_BASE_URL: 'https://example.test/api/v1',
  OPENROUTER_MODEL: 'a/primary:free',
  OPENROUTER_FALLBACK_MODELS: 'b/fallback:free, c/zdr',
};

describe('OpenRouterZdrCheck', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  function fetchOk(data: unknown): jest.Mock {
    return jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(data),
      }),
    );
  }

  it('warns once per configured model without a ZDR endpoint, sends no key', async () => {
    const fetchFn = fetchOk({
      data: [{ model_id: 'c/zdr' }, { model_id: 'x/y' }],
    });
    await new OpenRouterZdrCheck(config(BASE), fetchFn as FetchFn).check();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://example.test/api/v1/endpoints/zdr',
    );
    expect(JSON.stringify(fetchFn.mock.calls[0])).not.toContain('sk-or-secret');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('a/primary:free');
    expect(String(warn.mock.calls[1][0])).toContain('b/fallback:free');
  });

  it('matches model ids exactly (a model without :free is not a match)', async () => {
    const fetchFn = fetchOk({ data: [{ model_id: 'a/primary' }] });
    await new OpenRouterZdrCheck(
      config({ ...BASE, OPENROUTER_FALLBACK_MODELS: '' }),
      fetchFn as FetchFn,
    ).check();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no api key', { OPENROUTER_API_KEY: '' }],
    ['zdr disabled', { OPENROUTER_REQUIRE_ZDR: false }],
    ['test env', { NODE_ENV: 'test' }],
  ])('does not fetch when %s', async (_n, extra) => {
    const fetchFn = fetchOk({ data: [] });
    await new OpenRouterZdrCheck(
      config({ ...BASE, ...extra }),
      fetchFn as FetchFn,
    ).check();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never throws: fetch failure, bad status and bad body warn once', async () => {
    const failing: FetchFn = () => Promise.reject(new Error('boom'));
    await expect(
      new OpenRouterZdrCheck(config(BASE), failing).check(),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockClear();
    const bad: FetchFn = () =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });
    await new OpenRouterZdrCheck(config(BASE), bad).check();
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockClear();
    await new OpenRouterZdrCheck(
      config(BASE),
      fetchOk({ nope: 1 }) as FetchFn,
    ).check();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('skips openrouter/free (the gateway already warns about it)', async () => {
    const fetchFn = fetchOk({ data: [] });
    await new OpenRouterZdrCheck(
      config({
        ...BASE,
        OPENROUTER_MODEL: 'openrouter/free',
        OPENROUTER_FALLBACK_MODELS: '',
      }),
      fetchFn as FetchFn,
    ).check();
    expect(warn).not.toHaveBeenCalled();
  });
});
