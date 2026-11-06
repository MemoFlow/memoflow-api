import {
  assertPostgresSslSafe,
  parsePostgresSslRejectUnauthorized,
  postgresSslOptions,
} from './postgres-ssl';

describe('parsePostgresSslRejectUnauthorized', () => {
  it.each([undefined, null, '', '  ', 'true', 'TRUE', true])(
    'verifies for %p',
    (value) => {
      expect(parsePostgresSslRejectUnauthorized(value)).toBe(true);
    },
  );

  it.each(['false', 'FALSE', ' false ', false])(
    'does not verify for %p',
    (value) => {
      expect(parsePostgresSslRejectUnauthorized(value)).toBe(false);
    },
  );

  it.each(['0', 'no', 'fasle', 'yes', 1, {}])('throws for %p', (value) => {
    expect(() => parsePostgresSslRejectUnauthorized(value)).toThrow(
      'POSTGRES_SSL_REJECT_UNAUTHORIZED',
    );
  });
});

describe('postgresSslOptions', () => {
  it('is false when POSTGRES_SSL is off, whatever the reject flag says', () => {
    expect(postgresSslOptions(undefined, undefined)).toBe(false);
    expect(postgresSslOptions('false', 'false')).toBe(false);
  });

  it('verifies certificates by default when SSL is on', () => {
    expect(postgresSslOptions('true', undefined)).toEqual({
      rejectUnauthorized: true,
    });
    expect(postgresSslOptions(true, true)).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('only relaxes verification on an explicit false', () => {
    expect(postgresSslOptions('true', 'false')).toEqual({
      rejectUnauthorized: false,
    });
    expect(postgresSslOptions(true, false)).toEqual({
      rejectUnauthorized: false,
    });
  });
});

describe('assertPostgresSslSafe (CLI data source)', () => {
  it.each(['staging', 'production'])('throws for false in %s', (env) => {
    expect(() => assertPostgresSslSafe(env, 'false')).toThrow(
      'cannot be false',
    );
  });

  it.each(['staging', 'production'])('throws for a typo in %s', (env) => {
    expect(() => assertPostgresSslSafe(env, 'fasle')).toThrow();
  });

  it('throws for a typo on every tier', () => {
    expect(() => assertPostgresSslSafe('development', 'no')).toThrow();
    expect(() => assertPostgresSslSafe(undefined, 'no')).toThrow();
  });

  it('allows false on development/test/unset and true or unset anywhere', () => {
    expect(() => assertPostgresSslSafe('development', 'false')).not.toThrow();
    expect(() => assertPostgresSslSafe('test', 'false')).not.toThrow();
    expect(() => assertPostgresSslSafe(undefined, 'false')).not.toThrow();
    expect(() => assertPostgresSslSafe('production', 'true')).not.toThrow();
    expect(() => assertPostgresSslSafe('production', undefined)).not.toThrow();
  });
});
