import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'reflect-metadata';
import {
  JWT_SECRET_PLACEHOLDER,
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
    JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars-long',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    COMPOSIO_API_KEY: 'composio-test-key',
    COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_123,notion:ac_456,github:ac_789',
    COMPOSIO_WEBHOOK_SECRET: 'composio-test-webhook-secret',
    // Staging/production refuse wildcard origins; give those tiers safe ones
    // so each test only overrides what it is about.
    ...(overrides.NODE_ENV === 'staging' || overrides.NODE_ENV === 'production'
      ? {
          CORS_ORIGIN: 'https://app.memoflow.dev',
          WS_CORS_ORIGIN: 'https://app.memoflow.dev',
        }
      : {}),
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

  it('defaults CORS_ORIGIN to *', () => {
    const result = validate(baseConfig());
    expect(result.CORS_ORIGIN).toBe('*');
  });

  it('accepts an explicit CORS_ORIGIN', () => {
    const result = validate(
      baseConfig({ CORS_ORIGIN: 'https://app.memoflow.dev' }),
    );
    expect(result.CORS_ORIGIN).toBe('https://app.memoflow.dev');
  });

  it('defaults THROTTLE_TTL and THROTTLE_LIMIT', () => {
    const result = validate(baseConfig());
    expect(result.THROTTLE_TTL).toBe(60_000);
    expect(result.THROTTLE_LIMIT).toBe(100);
  });

  it('accepts explicit THROTTLE_TTL and THROTTLE_LIMIT', () => {
    const result = validate(
      baseConfig({ THROTTLE_TTL: '30000', THROTTLE_LIMIT: '20' }),
    );
    expect(result.THROTTLE_TTL).toBe(30_000);
    expect(result.THROTTLE_LIMIT).toBe(20);
  });

  it('rejects a THROTTLE_LIMIT below 1', () => {
    expect(() => validate(baseConfig({ THROTTLE_LIMIT: '0' }))).toThrow(
      /THROTTLE_LIMIT/,
    );
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

describe('env.validation JWT_SECRET', () => {
  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() =>
      validate(baseConfig({ JWT_SECRET: 'too-short-secret' })),
    ).toThrow(/JWT_SECRET/);
  });

  it('accepts a JWT_SECRET of 32 characters or more', () => {
    const result = validate(
      baseConfig({
        JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars-long',
      }),
    );
    expect(result.JWT_SECRET).toBe(
      'test-only-secret-that-is-at-least-32-chars-long',
    );
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

describe('env.validation SENTRY_*', () => {
  it('validates with all SENTRY_* vars absent (Sentry disabled by default)', () => {
    const result = validate(baseConfig());
    expect(result.SENTRY_DSN).toBeUndefined();
    expect(result.SENTRY_ENVIRONMENT).toBeUndefined();
    expect(result.SENTRY_TRACES_SAMPLE_RATE).toBe(0);
    expect(result.SENTRY_RELEASE).toBeUndefined();
  });

  it('accepts a valid SENTRY_DSN, SENTRY_ENVIRONMENT, and in-range sample rate', () => {
    const result = validate(
      baseConfig({
        SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0',
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_TRACES_SAMPLE_RATE: '0.5',
        SENTRY_RELEASE: 'memoflow-api@1.2.3',
      }),
    );
    expect(result.SENTRY_DSN).toBe('https://public@o0.ingest.sentry.io/0');
    expect(result.SENTRY_ENVIRONMENT).toBe('staging');
    expect(result.SENTRY_TRACES_SAMPLE_RATE).toBe(0.5);
    expect(result.SENTRY_RELEASE).toBe('memoflow-api@1.2.3');
  });

  it('rejects a SENTRY_TRACES_SAMPLE_RATE above 1', () => {
    expect(() =>
      validate(baseConfig({ SENTRY_TRACES_SAMPLE_RATE: '1.5' })),
    ).toThrow(/SENTRY_TRACES_SAMPLE_RATE/);
  });

  it('rejects a negative SENTRY_TRACES_SAMPLE_RATE', () => {
    expect(() =>
      validate(baseConfig({ SENTRY_TRACES_SAMPLE_RATE: '-0.1' })),
    ).toThrow(/SENTRY_TRACES_SAMPLE_RATE/);
  });
});

describe('env.validation email settings', () => {
  const mail = {
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'MemoFlow <no-reply@example.com>',
    APP_BASE_URL: 'https://app.example.com',
  };

  it('treats all mail settings as optional in development and test', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const result = validate(baseConfig({ NODE_ENV }));
      expect(result.RESEND_API_KEY).toBeUndefined();
      expect(result.EMAIL_VERIFICATION_REQUIRED).toBe(false);
    }
  });

  it('parses EMAIL_VERIFICATION_REQUIRED=true in development', () => {
    const result = validate(
      baseConfig({ EMAIL_VERIFICATION_REQUIRED: 'true' }),
    );
    expect(result.EMAIL_VERIFICATION_REQUIRED).toBe(true);
  });

  it.each(['staging', 'production'])(
    'fails boot in %s when a mail setting is missing',
    (NODE_ENV) => {
      for (const key of Object.keys(mail)) {
        const partial: Record<string, string> = { ...mail };
        delete partial[key];
        expect(() => validate(baseConfig({ NODE_ENV, ...partial }))).toThrow(
          key,
        );
      }
    },
  );

  it.each(['staging', 'production'])(
    'forces verification on in %s when the flag is unset',
    (NODE_ENV) => {
      const result = validate(baseConfig({ NODE_ENV, ...mail }));
      expect(result.EMAIL_VERIFICATION_REQUIRED).toBe(true);
    },
  );

  it.each(['staging', 'production'])(
    'rejects an explicit EMAIL_VERIFICATION_REQUIRED=false in %s',
    (NODE_ENV) => {
      expect(() =>
        validate(
          baseConfig({
            NODE_ENV,
            ...mail,
            EMAIL_VERIFICATION_REQUIRED: 'false',
          }),
        ),
      ).toThrow('EMAIL_VERIFICATION_REQUIRED');
    },
  );

  it('accepts an explicit EMAIL_VERIFICATION_REQUIRED=true in production', () => {
    const result = validate(
      baseConfig({
        NODE_ENV: 'production',
        ...mail,
        EMAIL_VERIFICATION_REQUIRED: 'true',
      }),
    );
    expect(result.EMAIL_VERIFICATION_REQUIRED).toBe(true);
  });
});

describe('env.validation APP_BASE_URL', () => {
  it.each([
    'https://app.example.com',
    'http://localhost:5173',
    'https://app.example.com/',
  ])('accepts %s', (APP_BASE_URL) => {
    expect(validate(baseConfig({ APP_BASE_URL })).APP_BASE_URL).toBe(
      APP_BASE_URL,
    );
  });

  it.each([
    'app.example.com',
    'ftp://app.example.com',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (APP_BASE_URL) => {
    expect(() => validate(baseConfig({ APP_BASE_URL }))).toThrow(
      'APP_BASE_URL',
    );
  });
});

describe('env.validation blank and strict mail settings', () => {
  it.each([
    'https://memoflow-client.vercel.app',
    'https://memoflow-client.vercel.app/',
    'http://localhost:5173',
    'http://localhost:5173/',
    'https://a.com/app',
  ])('accepts %s', (APP_BASE_URL) => {
    expect(validate(baseConfig({ APP_BASE_URL })).APP_BASE_URL).toBe(
      APP_BASE_URL,
    );
  });

  it.each([
    'https://a.com/?x=1',
    'https://a.com?x=1',
    'https://u:p@a.com',
    'https://a.com/#x',
    'https://a.com/?',
  ])('rejects %s', (APP_BASE_URL) => {
    expect(() => validate(baseConfig({ APP_BASE_URL }))).toThrow(
      'APP_BASE_URL',
    );
  });

  it.each(['', '  '])('treats blank %j as unset in development', (blank) => {
    const result = validate(
      baseConfig({
        NODE_ENV: 'development',
        APP_BASE_URL: blank,
        RESEND_API_KEY: blank,
        EMAIL_FROM: blank,
        EMAIL_VERIFICATION_REQUIRED: blank,
      }),
    );
    expect(result.APP_BASE_URL).toBeUndefined();
    expect(result.RESEND_API_KEY).toBeUndefined();
    expect(result.EMAIL_FROM).toBeUndefined();
    expect(result.EMAIL_VERIFICATION_REQUIRED).toBe(false);
  });

  it('boots with the blank values shipped in .env.example', () => {
    const env: Record<string, string> = {};
    for (const line of readFileSync(
      join(__dirname, '..', '..', '.env.example'),
      'utf8',
    ).split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m) env[m[1]] = m[2];
    }
    expect(env.APP_BASE_URL).toBe('');
    expect(() => validate(env)).not.toThrow();
  });

  it.each(['staging', 'production'])(
    'still rejects blank mail settings in %s',
    (NODE_ENV) => {
      expect(() =>
        validate(
          baseConfig({
            NODE_ENV,
            RESEND_API_KEY: ' ',
            EMAIL_FROM: '',
            APP_BASE_URL: '',
          }),
        ),
      ).toThrow('required when NODE_ENV');
    },
  );
});

describe('env.validation deployed-tier safety checks', () => {
  const mail = {
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'MemoFlow <no-reply@example.com>',
    APP_BASE_URL: 'https://app.example.com',
  };

  it.each(['staging', 'production'])(
    'accepts explicit origins and a real secret in %s',
    (NODE_ENV) => {
      expect(() => validate(baseConfig({ NODE_ENV, ...mail }))).not.toThrow();
    },
  );

  it.each([
    ['staging', 'CORS_ORIGIN'],
    ['staging', 'WS_CORS_ORIGIN'],
    ['production', 'CORS_ORIGIN'],
    ['production', 'WS_CORS_ORIGIN'],
  ])('rejects a wildcard in %s %s', (NODE_ENV, key) => {
    expect(() =>
      validate(baseConfig({ NODE_ENV, ...mail, [key]: '*' })),
    ).toThrow(new RegExp(`${key}: cannot be blank or '\\*'`));
  });

  it.each(
    ['staging', 'production'].flatMap((env) =>
      ['CORS_ORIGIN', 'WS_CORS_ORIGIN'].flatMap((key) =>
        ['', '   '].map((blank) => [env, key, blank]),
      ),
    ),
  )('rejects a blank %s %s value %j', (NODE_ENV, key, blank) => {
    expect(() =>
      validate(baseConfig({ NODE_ENV, ...mail, [key]: blank })),
    ).toThrow(new RegExp(`${key}: cannot be blank`));
  });

  it.each(['staging', 'production'])(
    'rejects an unset (defaulted) wildcard origin in %s',
    (NODE_ENV) => {
      const config = baseConfig({ NODE_ENV, ...mail });
      delete (config as Record<string, unknown>).CORS_ORIGIN;
      expect(() => validate(config)).toThrow('CORS_ORIGIN');
    },
  );

  it.each(['staging', 'production'])(
    'rejects the .env.example JWT_SECRET placeholder in %s',
    (NODE_ENV) => {
      expect(() =>
        validate(
          baseConfig({ NODE_ENV, ...mail, JWT_SECRET: JWT_SECRET_PLACEHOLDER }),
        ),
      ).toThrow('JWT_SECRET');
    },
  );

  it.each(['development', 'test'])(
    'leaves %s unaffected (wildcards and the placeholder are fine)',
    (NODE_ENV) => {
      expect(() =>
        validate(
          baseConfig({
            NODE_ENV,
            CORS_ORIGIN: '*',
            WS_CORS_ORIGIN: '*',
            JWT_SECRET: JWT_SECRET_PLACEHOLDER,
          }),
        ),
      ).not.toThrow();
    },
  );

  it('keeps the placeholder constant in sync with .env.example', () => {
    const example = readFileSync(join(__dirname, '../../.env.example'), 'utf8');
    expect(example).toContain(`JWT_SECRET=${JWT_SECRET_PLACEHOLDER}`);
  });

  describe('POSTGRES_SSL_REJECT_UNAUTHORIZED', () => {
    it.each(['staging', 'production'])('rejects false in %s', (NODE_ENV) => {
      expect(() =>
        validate(
          baseConfig({
            NODE_ENV,
            ...mail,
            POSTGRES_SSL: 'true',
            POSTGRES_SSL_REJECT_UNAUTHORIZED: 'false',
          }),
        ),
      ).toThrow('POSTGRES_SSL_REJECT_UNAUTHORIZED');
    });

    it.each(['staging', 'production'])(
      'accepts it unset or true in %s',
      (NODE_ENV) => {
        expect(() =>
          validate(baseConfig({ NODE_ENV, ...mail, POSTGRES_SSL: 'true' })),
        ).not.toThrow();
        expect(() =>
          validate(
            baseConfig({
              NODE_ENV,
              ...mail,
              POSTGRES_SSL_REJECT_UNAUTHORIZED: 'TRUE',
            }),
          ),
        ).not.toThrow();
      },
    );

    it.each(['development', 'test'])('allows false in %s', (NODE_ENV) => {
      const result = validate(
        baseConfig({ NODE_ENV, POSTGRES_SSL_REJECT_UNAUTHORIZED: 'false' }),
      );
      expect(result.POSTGRES_SSL_REJECT_UNAUTHORIZED).toBe(false);
    });

    it.each(['development', 'test', 'staging', 'production'])(
      'rejects an unparsable value in %s',
      (NODE_ENV) => {
        expect(() =>
          validate(
            baseConfig({
              NODE_ENV,
              ...mail,
              POSTGRES_SSL_REJECT_UNAUTHORIZED: 'fasle',
            }),
          ),
        ).toThrow('POSTGRES_SSL_REJECT_UNAUTHORIZED');
      },
    );

    it('defaults to true when unset or blank', () => {
      expect(validate(baseConfig()).POSTGRES_SSL_REJECT_UNAUTHORIZED).toBe(
        true,
      );
      expect(
        validate(baseConfig({ POSTGRES_SSL_REJECT_UNAUTHORIZED: '' }))
          .POSTGRES_SSL_REJECT_UNAUTHORIZED,
      ).toBe(true);
    });
  });
});
