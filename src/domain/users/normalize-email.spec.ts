import { normalizeEmail } from './normalize-email';

describe('normalizeEmail', () => {
  it('lowercases the address', () => {
    expect(normalizeEmail('Ada@Example.COM')).toBe('ada@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  ada@example.com\n')).toBe('ada@example.com');
  });

  it('leaves an already canonical address unchanged', () => {
    expect(normalizeEmail('ada@example.com')).toBe('ada@example.com');
  });
});
