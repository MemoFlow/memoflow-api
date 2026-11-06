import {
  buildResetLink,
  buildVerifyLink,
  verificationEmail,
} from './auth-emails';

describe('auth email links', () => {
  it.each([
    'https://app.example.com',
    'https://app.example.com/',
    'https://app.example.com///',
  ])('never produces a double slash for base %s', (base) => {
    expect(buildResetLink(base, 'tok')).toBe(
      'https://app.example.com/reset-password#token=tok',
    );
    expect(buildVerifyLink(base, 'tok')).toBe(
      'https://app.example.com/verify-email#token=tok',
    );
  });

  it('keeps a path prefix in the base URL', () => {
    expect(buildResetLink('https://a.com/app/', 'tok')).toBe(
      'https://a.com/app/reset-password#token=tok',
    );
  });

  it('tells a recipient who did not sign up that nothing will be verified', () => {
    expect(verificationEmail('a@b.com', 'link').text).toContain(
      "If you didn't create this account, ignore this email and the address will stay unverified.",
    );
  });
});
