import { ConfigService } from '@nestjs/config';
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import {
  SuggestionGenerationProviderError,
  SuggestionGenerationRefusedError,
  SuggestionGenerationTruncatedError,
  SuggestionGeneratorRateLimitedError,
  SuggestionGeneratorUnavailableError,
} from '../../domain/ai/suggestion-generation.errors';
import { OpenRouterGateway } from './openrouter.gateway';

const API_KEY = 'sk-or-super-secret-key';
const REQUEST = {
  system: 'sys',
  user: 'usr',
  jsonSchema: {
    name: 'thing',
    schema: { type: 'object', properties: { a: { type: 'string' } } },
  },
};

interface Captured {
  headers: IncomingMessage['headers'];
  url: string;
  body: Record<string, unknown>;
}
type Handler = (req: Captured, res: ServerResponse, n: number) => void;

describe('OpenRouterGateway (fake HTTP server)', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  let captured: Captured[];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const c: Captured = {
          headers: req.headers,
          url: req.url ?? '',
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
            string,
            unknown
          >,
        };
        captured.push(c);
        handler(c, res, captured.length);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    captured = [];
  });

  function gateway(extra: Record<string, unknown> = {}): OpenRouterGateway {
    const values: Record<string, unknown> = {
      OPENROUTER_API_KEY: API_KEY,
      OPENROUTER_BASE_URL: baseUrl,
      OPENROUTER_MODEL: 'primary/model',
      OPENROUTER_TIMEOUT_MS: 2000,
      OPENROUTER_MAX_TOKENS: 777,
      ...extra,
    };
    return new OpenRouterGateway({
      get: (k: string) => values[k],
    } as unknown as ConfigService);
  }

  const json = (
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): void => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const ok = (
    content: unknown,
    extra: Record<string, unknown> = {},
    finish = 'stop',
  ) => ({
    model: 'served/model',
    choices: [{ finish_reason: finish, message: { content } }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    ...extra,
  });

  async function failure(g: OpenRouterGateway): Promise<Error> {
    try {
      await g.complete(REQUEST);
    } catch (e) {
      return e as Error;
    }
    throw new Error('expected failure');
  }

  it('is unavailable without a key and throws Unavailable without calling out', async () => {
    const g = gateway({ OPENROUTER_API_KEY: '' });
    expect(g.isAvailable()).toBe(false);
    await expect(g.complete(REQUEST)).rejects.toThrow(
      SuggestionGeneratorUnavailableError,
    );
    expect(captured).toHaveLength(0);
  });

  it('sends the expected request and returns parsed JSON, served model and usage', async () => {
    handler = (_r, res) => json(res, 200, ok('{"a":"b"}'));
    const g = gateway();
    expect(g.isAvailable()).toBe(true);

    const result = await g.complete(REQUEST);

    expect(result).toEqual({
      json: { a: 'b' },
      model: 'served/model',
      finishReason: 'stop',
      usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
    });
    const [req] = captured;
    expect(req.url).toBe('/api/v1/chat/completions');
    expect(req.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(req.body).toMatchObject({
      model: 'primary/model',
      max_tokens: 777,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'thing', schema: REQUEST.jsonSchema.schema },
      },
    });
    expect(req.body.models).toBeUndefined();
  });

  it('lets a per-call maxTokens override the configured default', async () => {
    handler = (_r, res) => json(res, 200, ok('{}'));
    await gateway().complete({ ...REQUEST, maxTokens: 5 });
    expect(captured[0].body.max_tokens).toBe(5);
  });

  it('sends a models array when fallbacks are configured', async () => {
    handler = (_r, res) => json(res, 200, ok('{}'));
    await gateway({
      OPENROUTER_FALLBACK_MODELS: ' fb/one, fb/two ,,',
    }).complete(REQUEST);
    expect(captured[0].body.models).toEqual([
      'primary/model',
      'fb/one',
      'fb/two',
    ]);
  });

  it('strips a surrounding markdown code fence', async () => {
    handler = (_r, res) => json(res, 200, ok('```json\n{"a":"b"}\n```'));
    const result = await gateway().complete(REQUEST);
    expect(result.json).toEqual({ a: 'b' });
    expect(captured).toHaveLength(1);
  });

  it('maps 429 with retry-after to RateLimited carrying the seconds', async () => {
    handler = (_r, res) =>
      json(
        res,
        429,
        { error: { message: 'secret detail' } },
        { 'retry-after': '30' },
      );
    const err = await failure(gateway());
    expect(err).toBeInstanceOf(SuggestionGeneratorRateLimitedError);
    expect((err as SuggestionGeneratorRateLimitedError).retryAfterSeconds).toBe(
      30,
    );
    expect(err.message).not.toContain('secret detail');
  });

  it('maps 429 without (or with invalid) retry-after to RateLimited without seconds', async () => {
    handler = (_r, res) => json(res, 429, {});
    let err = await failure(gateway());
    expect(err).toBeInstanceOf(SuggestionGeneratorRateLimitedError);
    expect(
      (err as SuggestionGeneratorRateLimitedError).retryAfterSeconds,
    ).toBeUndefined();

    handler = (_r, res) => json(res, 429, {}, { 'retry-after': 'soon' });
    err = await failure(gateway());
    expect(
      (err as SuggestionGeneratorRateLimitedError).retryAfterSeconds,
    ).toBeUndefined();
  });

  it.each([500, 502, 503])('maps HTTP %i to Unavailable', async (status) => {
    handler = (_r, res) => json(res, status, { error: { message: 'boom' } });
    expect(await failure(gateway())).toBeInstanceOf(
      SuggestionGeneratorUnavailableError,
    );
  });

  it.each([401, 403, 400, 402])(
    'maps HTTP %i to ProviderError',
    async (status) => {
      handler = (_r, res) =>
        json(res, status, { error: { message: 'raw provider text' } });
      const err = await failure(gateway());
      expect(err).toBeInstanceOf(SuggestionGenerationProviderError);
      expect(err.message).not.toContain('raw provider text');
    },
  );

  it('maps an error object inside HTTP 200 by its code', async () => {
    handler = (_r, res) =>
      json(res, 200, { error: { code: 429, message: 'limited' } });
    expect(await failure(gateway())).toBeInstanceOf(
      SuggestionGeneratorRateLimitedError,
    );
    handler = (_r, res) =>
      json(res, 200, { error: { code: 503, message: 'down' } });
    expect(await failure(gateway())).toBeInstanceOf(
      SuggestionGeneratorUnavailableError,
    );
    handler = (_r, res) =>
      json(res, 200, { error: { code: 401, message: 'bad key' } });
    expect(await failure(gateway())).toBeInstanceOf(
      SuggestionGenerationProviderError,
    );
  });

  it('maps finish_reason length to Truncated', async () => {
    handler = (_r, res) => json(res, 200, ok('{"a"', {}, 'length'));
    expect(await failure(gateway())).toBeInstanceOf(
      SuggestionGenerationTruncatedError,
    );
  });

  it('maps finish_reason content_filter to Refused', async () => {
    handler = (_r, res) => json(res, 200, ok('', {}, 'content_filter'));
    expect(await failure(gateway())).toBeInstanceOf(
      SuggestionGenerationRefusedError,
    );
  });

  it('maps empty choices and empty content to ProviderError', async () => {
    handler = (_r, res) => json(res, 200, { model: 'm', choices: [] });
    expect(await failure(gateway())).toBeInstanceOf(
      SuggestionGenerationProviderError,
    );
    handler = (_r, res) => json(res, 200, ok(''));
    expect(await failure(gateway())).toBeInstanceOf(
      SuggestionGenerationProviderError,
    );
    handler = (_r, res) => json(res, 200, ok(null));
    expect(await failure(gateway())).toBeInstanceOf(
      SuggestionGenerationProviderError,
    );
  });

  it('repairs once: non-JSON then valid JSON succeeds, re-asking for only JSON', async () => {
    handler = (_r, res, n) =>
      json(res, 200, ok(n === 1 ? 'Sure! Here you go.' : '{"a":"fixed"}'));
    const result = await gateway().complete(REQUEST);

    expect(result.json).toEqual({ a: 'fixed' });
    expect(captured).toHaveLength(2);
    const messages = captured[1].body.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages).toHaveLength(4);
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: 'Sure! Here you go.',
    });
    expect(messages[3].role).toBe('user');
    expect(messages[3].content).toMatch(/ONLY the JSON/);
  });

  it('gives up after one repair: non-JSON twice is ProviderError', async () => {
    handler = (_r, res) => json(res, 200, ok('still not json'));
    const err = await failure(gateway());
    expect(err).toBeInstanceOf(SuggestionGenerationProviderError);
    expect(captured).toHaveLength(2);
    expect(err.message).not.toContain('still not json');
  });

  it('maps a timeout to Unavailable', async () => {
    handler = () => {
      /* never respond */
    };
    const err = await failure(gateway({ OPENROUTER_TIMEOUT_MS: 100 }));
    expect(err).toBeInstanceOf(SuggestionGeneratorUnavailableError);
  });

  it('maps a timeout during the body read to Unavailable', async () => {
    handler = (_r, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"choices":');
      // body never finishes
    };
    const err = await failure(gateway({ OPENROUTER_TIMEOUT_MS: 150 }));
    expect(err).toBeInstanceOf(SuggestionGeneratorUnavailableError);
  });

  it('keeps the status mapping when the body read fails (429 and 401)', async () => {
    for (const [status, cls] of [
      [429, SuggestionGeneratorRateLimitedError],
      [401, SuggestionGenerationProviderError],
    ] as const) {
      handler = (_r, res) => {
        res.writeHead(status, {
          'content-length': '1000',
          'retry-after': '7',
        });
        res.write('partial');
        setTimeout(() => res.socket?.destroy(), 20);
      };
      const err = await failure(gateway());
      expect(err).toBeInstanceOf(cls);
    }
  });

  it('bounds the whole call, repair included, by one deadline', async () => {
    handler = (_r, res, n) => {
      if (n === 1) {
        setTimeout(() => json(res, 200, ok('prose, not json')), 1000);
      }
      // the retry never answers: it must abort at the shared deadline
    };
    const started = Date.now();
    const err = await failure(gateway({ OPENROUTER_TIMEOUT_MS: 2000 }));
    const elapsed = Date.now() - started;

    expect(err).toBeInstanceOf(SuggestionGeneratorUnavailableError);
    expect(captured).toHaveLength(2);
    // A fresh 2000ms budget for the retry would take >= 3000ms.
    expect(elapsed).toBeLessThan(2800);
  });

  it('skips the repair and fails like a failed repair when no budget remains', async () => {
    const realNow: () => number = Date.now.bind(Date);
    let offset = 0;
    const spy = jest
      .spyOn(Date, 'now')
      .mockImplementation(() => realNow() + offset);
    handler = (_r, res) => {
      offset = 60_000;
      json(res, 200, ok('prose, not json'));
    };
    try {
      const err = await failure(gateway());
      expect(err).toBeInstanceOf(SuggestionGenerationProviderError);
      expect(captured).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('sums usage across the first call and the repair retry', async () => {
    handler = (_r, res, n) =>
      json(
        res,
        200,
        n === 1
          ? ok('nope', { usage: { prompt_tokens: 3, total_tokens: 3 } })
          : ok('{"a":"b"}', {
              usage: {
                prompt_tokens: 5,
                completion_tokens: 2,
                total_tokens: 7,
              },
            }),
      );
    const result = await gateway().complete(REQUEST);
    expect(result.usage).toEqual({
      promptTokens: 8,
      completionTokens: 2,
      totalTokens: 10,
    });
  });

  it('accepts an HTTP-date retry-after', async () => {
    handler = (_r, res) =>
      json(
        res,
        429,
        {},
        {
          'retry-after': new Date(Date.now() + 30_000).toUTCString(),
        },
      );
    const err = (await failure(
      gateway(),
    )) as SuggestionGeneratorRateLimitedError;
    expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(28);
    expect(err.retryAfterSeconds).toBeLessThanOrEqual(30);

    handler = (_r, res) =>
      json(res, 429, {}, { 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' });
    const past = (await failure(
      gateway(),
    )) as SuggestionGeneratorRateLimitedError;
    expect(past.retryAfterSeconds).toBe(0);
  });

  it('maps a network failure to Unavailable', async () => {
    const err = await failure(
      gateway({ OPENROUTER_BASE_URL: 'http://127.0.0.1:1/api/v1' }),
    );
    expect(err).toBeInstanceOf(SuggestionGeneratorUnavailableError);
  });

  it('never leaks the API key in any thrown error message', async () => {
    const handlers: Handler[] = [
      (_r, res) => json(res, 401, { error: { message: `bad key ${API_KEY}` } }),
      (_r, res) => json(res, 429, {}),
      (_r, res) => json(res, 503, {}),
      (_r, res) => json(res, 200, ok('nope')),
      (_r, res) => json(res, 200, { choices: [] }),
    ];
    for (const h of handlers) {
      handler = h;
      const err = await failure(gateway());
      expect(err.message).not.toContain(API_KEY);
      expect(err.stack ?? '').not.toContain(API_KEY);
    }
    const net = await failure(
      gateway({ OPENROUTER_BASE_URL: 'http://127.0.0.1:1/api/v1' }),
    );
    expect(net.message).not.toContain(API_KEY);
  });
});
