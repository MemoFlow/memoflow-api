import { generateAuthToken, hashAuthToken } from './auth-token';

describe('auth token helpers', () => {
  it('generates url-safe tokens with 256 bits of entropy', () => {
    const token = generateAuthToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates a different token each time', () => {
    expect(generateAuthToken()).not.toBe(generateAuthToken());
  });

  it('hashes to a stable SHA-256 hex digest that differs from the token', () => {
    const hash = hashAuthToken('abc');
    expect(hash).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashAuthToken('abc')).toBe(hash);
    expect(hashAuthToken('abd')).not.toBe(hash);
  });
});
