import { AuthTokenType, hashAuthToken } from '../../domain/auth/auth-token';
import { SendVerificationEmailUseCase } from './send-verification-email.use-case';
import {
  FakeAuthTokenRepository,
  FakeEmailSender,
  FakeUserRepository,
  makeUser,
} from './testing-fakes';

describe('SendVerificationEmailUseCase', () => {
  let users: FakeUserRepository;
  let tokens: FakeAuthTokenRepository;
  let sender: FakeEmailSender;

  const BASE = 'https://app.example.com/';

  function build(appBaseUrl: string | undefined) {
    return new SendVerificationEmailUseCase(users, tokens, sender, {
      appBaseUrl,
    });
  }

  function buildWithoutBaseUrl() {
    return build(undefined);
  }

  beforeEach(() => {
    users = new FakeUserRepository([makeUser()]);
    tokens = new FakeAuthTokenRepository();
    sender = new FakeEmailSender();
  });

  it('stores a hashed token and mails a fragment link built from the configured base URL', async () => {
    await build(BASE).execute('user-1');

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe('ada@example.com');
    const match =
      /^https:\/\/app\.example\.com\/verify-email#token=(\S+)$/m.exec(
        sender.sent[0].text,
      );
    expect(match).not.toBeNull();
    const raw = match![1];
    expect(tokens.issued).toHaveLength(1);
    expect(tokens.issued[0].type).toBe(AuthTokenType.EmailVerification);
    expect(tokens.issued[0].tokenHash).toBe(hashAuthToken(raw));
    expect(tokens.issued[0].tokenHash).not.toBe(raw);
    const ttl = tokens.issued[0].expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23.9 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3600_000);
  });

  it('sends nothing for an unknown, disabled or already verified account', async () => {
    users.users.push(
      makeUser({ id: 'd', disabledAt: new Date() }),
      makeUser({ id: 'v', emailVerifiedAt: new Date() }),
    );
    for (const id of ['nope', 'd', 'v']) {
      await build(BASE).execute(id);
    }
    expect(sender.sent).toHaveLength(0);
    expect(tokens.issued).toHaveLength(0);
  });

  it('sends nothing when the per-account issue limit applies', async () => {
    await build(BASE).execute('user-1');
    await build(BASE).execute('user-1');

    expect(sender.sent).toHaveLength(1);
    expect(tokens.issued).toHaveLength(1);
  });

  it('skips without creating a token when APP_BASE_URL is unset', async () => {
    await buildWithoutBaseUrl().execute('user-1');

    expect(sender.sent).toHaveLength(0);
    expect(tokens.issued).toHaveLength(0);
  });

  it('propagates a delivery failure to the caller', async () => {
    sender.failWith = new Error('provider down');
    await expect(build(BASE).execute('user-1')).rejects.toThrow(
      'provider down',
    );
  });
});
