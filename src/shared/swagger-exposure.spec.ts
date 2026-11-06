import { isSwaggerEnabled } from './swagger-exposure';

describe('isSwaggerEnabled', () => {
  it.each(['development', 'test'])('serves Swagger in %s', (env) => {
    expect(isSwaggerEnabled(env)).toBe(true);
  });

  it.each(['staging', 'production', 'preview', '', 'Development', undefined])(
    'does not serve Swagger for %p',
    (env) => {
      expect(isSwaggerEnabled(env)).toBe(false);
    },
  );
});
