import { ConfigService } from '@nestjs/config';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { ContextEngineHttpClient } from './context-engine.http-client';

class FakeConnectorConnectionRepository implements ConnectorConnectionRepository {
  constructor(private readonly active: ConnectorConnection[]) {}

  findById(): ReturnType<ConnectorConnectionRepository['findById']> {
    return Promise.reject(new Error('not implemented'));
  }

  findByUserAndProvider(): ReturnType<
    ConnectorConnectionRepository['findByUserAndProvider']
  > {
    return Promise.reject(new Error('not implemented'));
  }

  findByComposioAccountId(): ReturnType<
    ConnectorConnectionRepository['findByComposioAccountId']
  > {
    return Promise.reject(new Error('not implemented'));
  }

  findAllByUser(): ReturnType<ConnectorConnectionRepository['findAllByUser']> {
    return Promise.reject(new Error('not implemented'));
  }

  findActiveByUser(): Promise<ConnectorConnection[]> {
    return Promise.resolve(this.active);
  }

  upsertInitiated(): ReturnType<
    ConnectorConnectionRepository['upsertInitiated']
  > {
    return Promise.reject(new Error('not implemented'));
  }

  updateStatus(): ReturnType<ConnectorConnectionRepository['updateStatus']> {
    return Promise.reject(new Error('not implemented'));
  }
}

function makeConnection(
  overrides: Partial<ConnectorConnection> = {},
): ConnectorConnection {
  return new ConnectorConnection({
    id: 'conn-1',
    userId: 'user-1',
    provider: ConnectorProvider.Trello,
    composioAccountId: 'ca_trello',
    status: ConnectorStatus.Active,
    connectedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function makeConfig(
  values: Record<string, string | number | undefined>,
): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Missing config key "${key}"`);
      }
      return value;
    },
  } as unknown as ConfigService;
}

describe('ContextEngineHttpClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('posts only active+requested connectors — built from the loaded rows, no gateway call — and returns the parsed context', async () => {
    const active = [
      makeConnection({ provider: ConnectorProvider.Trello }),
      makeConnection({
        id: 'conn-2',
        provider: ConnectorProvider.Notion,
        composioAccountId: 'ca_notion',
      }),
    ];
    const repository = new FakeConnectorConnectionRepository(active);
    const config = makeConfig({
      CONTEXT_ENGINE_URL: 'https://context-engine.example.com/gather',
    });
    const client = new ContextEngineHttpClient(repository, config);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ sections: ['a'] }),
    });
    global.fetch = fetchMock;

    const result = await client.gatherContext({
      userId: 'user-1',
      // "github" is requested but not an active connection — must be skipped.
      connectors: ['trello', 'github'],
      prompt: 'Plan my chapter',
    });

    expect(result).toEqual({ sections: ['a'] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://context-engine.example.com/gather');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      userId: 'user-1',
      connectors: [
        { provider: 'trello', mcpUrl: null, composioAccountId: 'ca_trello' },
      ],
      prompt: 'Plan my chapter',
    });
    expect(
      (options.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('skips an active row with no composioAccountId rather than pushing a broken reference', async () => {
    const active = [
      makeConnection({ composioAccountId: null }),
      makeConnection({
        id: 'conn-2',
        provider: ConnectorProvider.Notion,
        composioAccountId: 'ca_notion',
      }),
    ];
    const repository = new FakeConnectorConnectionRepository(active);
    const config = makeConfig({
      CONTEXT_ENGINE_URL: 'https://context-engine.example.com/gather',
    });
    const client = new ContextEngineHttpClient(repository, config);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchMock;

    await client.gatherContext({
      userId: 'user-1',
      connectors: ['trello', 'notion'],
      prompt: 'hi',
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string).connectors).toEqual([
      { provider: 'notion', mcpUrl: null, composioAccountId: 'ca_notion' },
    ]);
  });

  it('sends the API key as an Authorization: Bearer header when configured', async () => {
    const repository = new FakeConnectorConnectionRepository([
      makeConnection(),
    ]);
    const config = makeConfig({
      CONTEXT_ENGINE_URL: 'https://context-engine.example.com/gather',
      CONTEXT_ENGINE_API_KEY: 'secret-key',
    });
    const client = new ContextEngineHttpClient(repository, config);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchMock;

    await client.gatherContext({
      userId: 'user-1',
      connectors: ['trello'],
      prompt: 'hi',
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-key',
    );
  });

  it('uses CONTEXT_ENGINE_TIMEOUT_MS to bound the fetch call via AbortSignal.timeout', async () => {
    const repository = new FakeConnectorConnectionRepository([
      makeConnection(),
    ]);
    const config = makeConfig({
      CONTEXT_ENGINE_URL: 'https://context-engine.example.com/gather',
      CONTEXT_ENGINE_TIMEOUT_MS: 5_000,
    });
    const client = new ContextEngineHttpClient(repository, config);

    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({}),
    });

    await client.gatherContext({
      userId: 'user-1',
      connectors: ['trello'],
      prompt: 'hi',
    });

    expect(timeoutSpy).toHaveBeenCalledWith(5_000);
  });

  it('throws on a non-2xx response (so the use-case records the job failed)', async () => {
    const repository = new FakeConnectorConnectionRepository([
      makeConnection(),
    ]);
    const config = makeConfig({
      CONTEXT_ENGINE_URL: 'https://context-engine.example.com/gather',
    });
    const client = new ContextEngineHttpClient(repository, config);

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({}),
    });

    await expect(
      client.gatherContext({
        userId: 'user-1',
        connectors: ['trello'],
        prompt: 'hi',
      }),
    ).rejects.toThrow('503');
  });

  it('propagates a network error from fetch', async () => {
    const repository = new FakeConnectorConnectionRepository([
      makeConnection(),
    ]);
    const config = makeConfig({
      CONTEXT_ENGINE_URL: 'https://context-engine.example.com/gather',
    });
    const client = new ContextEngineHttpClient(repository, config);

    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      client.gatherContext({
        userId: 'user-1',
        connectors: ['trello'],
        prompt: 'hi',
      }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('propagates a timeout/abort as a rejection (so the use-case records the job failed)', async () => {
    const repository = new FakeConnectorConnectionRepository([
      makeConnection(),
    ]);
    const config = makeConfig({
      CONTEXT_ENGINE_URL: 'https://context-engine.example.com/gather',
      CONTEXT_ENGINE_TIMEOUT_MS: 1,
    });
    const client = new ContextEngineHttpClient(repository, config);

    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new DOMException('The operation was aborted', 'TimeoutError'),
      );

    await expect(
      client.gatherContext({
        userId: 'user-1',
        connectors: ['trello'],
        prompt: 'hi',
      }),
    ).rejects.toThrow('The operation was aborted');
  });

  it('throws a clear error when the response is 2xx but not valid JSON', async () => {
    const repository = new FakeConnectorConnectionRepository([
      makeConnection(),
    ]);
    const config = makeConfig({
      CONTEXT_ENGINE_URL: 'https://context-engine.example.com/gather',
    });
    const client = new ContextEngineHttpClient(repository, config);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON')),
    });

    await expect(
      client.gatherContext({
        userId: 'user-1',
        connectors: ['trello'],
        prompt: 'hi',
      }),
    ).rejects.toThrow('Context engine returned an invalid response');
  });
});
