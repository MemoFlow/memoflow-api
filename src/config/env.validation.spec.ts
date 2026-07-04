import 'reflect-metadata';
import {
  parseComposioAuthConfigIds,
  parsePostgresSsl,
  parseRedisTls,
  validate,
} from './env.validation';

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    MONGODB_URI: 'mongodb://localhost:27017/memoflow',
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '5432',
    POSTGRES_USER: 'memoflow',
    POSTGRES_PASSWORD: 'memoflow',
    POSTGRES_DB: 'memoflow',
    JWT_SECRET: 'test-secret',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    COMPOSIO_API_KEY: 'composio-test-key',
    COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_123,notion:ac_456,github:ac_789',
    COMPOSIO_WEBHOOK_SECRET: 'composio-test-webhook-secret',
    ...overrides,
  };
}

describe('env.validation POSTGRES_SSL', () => {
  it('defaults to false when unset', () => {
    const result = validate(baseConfig());
    expect(result.POSTGRES_SSL).toBe(false);
  });

  it('parses "true" as true', () => {
    const result = validate(baseConfig({ POSTGRES_SSL: 'true' }));
    expect(result.POSTGRES_SSL).toBe(true);
  });

  it('parses "false" as false', () => {
    const result = validate(baseConfig({ POSTGRES_SSL: 'false' }));
    expect(result.POSTGRES_SSL).toBe(false);
  });

  it('parses "TRUE" (case-insensitive) as true', () => {
    const result = validate(baseConfig({ POSTGRES_SSL: 'TRUE' }));
    expect(result.POSTGRES_SSL).toBe(true);
  });
});

describe('env.validation REDIS_*', () => {
  it('accepts a valid REDIS_PORT and defaults WS_CORS_ORIGIN to *', () => {
    const result = validate(baseConfig());
    expect(result.REDIS_HOST).toBe('localhost');
    expect(result.REDIS_PORT).toBe(6379);
    expect(result.REDIS_PASSWORD).toBeUndefined();
    expect(result.WS_CORS_ORIGIN).toBe('*');
  });

  it('accepts an explicit WS_CORS_ORIGIN and REDIS_PASSWORD', () => {
    const result = validate(
      baseConfig({
        REDIS_PASSWORD: 'super-secret',
        WS_CORS_ORIGIN: 'https://app.memoflow.dev',
      }),
    );
    expect(result.REDIS_PASSWORD).toBe('super-secret');
    expect(result.WS_CORS_ORIGIN).toBe('https://app.memoflow.dev');
  });

  it('rejects an out-of-range REDIS_PORT', () => {
    expect(() => validate(baseConfig({ REDIS_PORT: '70000' }))).toThrow(
      /REDIS_PORT/,
    );
  });

  it('rejects a missing REDIS_HOST', () => {
    const config = baseConfig();
    delete (config as Record<string, unknown>).REDIS_HOST;
    expect(() => validate(config)).toThrow(/REDIS_HOST/);
  });
});

describe('env.validation REDIS_TLS', () => {
  it('defaults to false when unset', () => {
    const result = validate(baseConfig());
    expect(result.REDIS_TLS).toBe(false);
  });

  it('parses "true" as true', () => {
    const result = validate(baseConfig({ REDIS_TLS: 'true' }));
    expect(result.REDIS_TLS).toBe(true);
  });

  it('parses "false" as false', () => {
    const result = validate(baseConfig({ REDIS_TLS: 'false' }));
    expect(result.REDIS_TLS).toBe(false);
  });

  it('parses "TRUE" (case-insensitive) as true', () => {
    const result = validate(baseConfig({ REDIS_TLS: 'TRUE' }));
    expect(result.REDIS_TLS).toBe(true);
  });
});

describe('parsePostgresSsl', () => {
  // Shared by env.validation.ts (runtime, via @Transform) and
  // typeorm.data-source.ts (migration CLI, reading process.env directly) —
  // both must agree so `migration:run` and the app boot with the same SSL
  // setting for the same POSTGRES_SSL value.
  it('parses "TRUE" as true', () => {
    expect(parsePostgresSsl('TRUE')).toBe(true);
  });

  it('parses "true" as true', () => {
    expect(parsePostgresSsl('true')).toBe(true);
  });

  it('parses "false" as false', () => {
    expect(parsePostgresSsl('false')).toBe(false);
  });

  it('parses undefined as false', () => {
    expect(parsePostgresSsl(undefined)).toBe(false);
  });
});

describe('parseRedisTls', () => {
  it('parses "TRUE" as true', () => {
    expect(parseRedisTls('TRUE')).toBe(true);
  });

  it('parses "true" as true', () => {
    expect(parseRedisTls('true')).toBe(true);
  });

  it('parses "false" as false', () => {
    expect(parseRedisTls('false')).toBe(false);
  });

  it('parses undefined as false', () => {
    expect(parseRedisTls(undefined)).toBe(false);
  });
});

describe('env.validation COMPOSIO_*', () => {
  it('requires COMPOSIO_API_KEY', () => {
    const config = baseConfig();
    delete (config as Record<string, unknown>).COMPOSIO_API_KEY;
    expect(() => validate(config)).toThrow(/COMPOSIO_API_KEY/);
  });

  it('requires COMPOSIO_AUTH_CONFIG_IDS', () => {
    const config = baseConfig();
    delete (config as Record<string, unknown>).COMPOSIO_AUTH_CONFIG_IDS;
    expect(() => validate(config)).toThrow(/COMPOSIO_AUTH_CONFIG_IDS/);
  });

  it('requires COMPOSIO_WEBHOOK_SECRET', () => {
    const config = baseConfig();
    delete (config as Record<string, unknown>).COMPOSIO_WEBHOOK_SECRET;
    expect(() => validate(config)).toThrow(/COMPOSIO_WEBHOOK_SECRET/);
  });

  it('COMPOSIO_BASE_URL is optional', () => {
    const result = validate(baseConfig());
    expect(result.COMPOSIO_BASE_URL).toBeUndefined();
  });

  it('accepts an explicit COMPOSIO_BASE_URL', () => {
    const result = validate(
      baseConfig({ COMPOSIO_BASE_URL: 'https://backend.composio.dev' }),
    );
    expect(result.COMPOSIO_BASE_URL).toBe('https://backend.composio.dev');
  });
});

describe('parseComposioAuthConfigIds', () => {
  it('parses a comma-separated provider:authConfigId map', () => {
    expect(
      parseComposioAuthConfigIds('trello:ac_123,notion:ac_456,github:ac_789'),
    ).toEqual({ trello: 'ac_123', notion: 'ac_456', github: 'ac_789' });
  });

  it('trims whitespace around entries and pairs', () => {
    expect(
      parseComposioAuthConfigIds(' trello : ac_123 , notion:ac_456 '),
    ).toEqual({ trello: 'ac_123', notion: 'ac_456' });
  });

  it('returns an empty object for undefined/empty input', () => {
    expect(parseComposioAuthConfigIds(undefined)).toEqual({});
    expect(parseComposioAuthConfigIds('')).toEqual({});
  });

  it('throws a clear error on a malformed entry', () => {
    expect(() => parseComposioAuthConfigIds('trello:ac_123,notion')).toThrow(
      /Invalid COMPOSIO_AUTH_CONFIG_IDS entry "notion"/,
    );
  });

  it('rejects an entry with a stray colon instead of truncating', () => {
    expect(() => parseComposioAuthConfigIds('trello:ac:123')).toThrow(
      /Invalid COMPOSIO_AUTH_CONFIG_IDS entry "trello:ac:123"/,
    );
  });

  it('rejects a duplicate provider', () => {
    expect(() => parseComposioAuthConfigIds('trello:ac_1,trello:ac_2')).toThrow(
      /Duplicate COMPOSIO_AUTH_CONFIG_IDS provider "trello"/,
    );
  });
});

describe('env.validation eager COMPOSIO_AUTH_CONFIG_IDS check', () => {
  it('fails boot on a malformed COMPOSIO_AUTH_CONFIG_IDS', () => {
    expect(() =>
      validate(baseConfig({ COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac:123' })),
    ).toThrow(/Invalid COMPOSIO_AUTH_CONFIG_IDS entry/);
  });
});
