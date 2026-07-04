import 'reflect-metadata';
import { parsePostgresSsl, parseRedisTls, validate } from './env.validation';

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
