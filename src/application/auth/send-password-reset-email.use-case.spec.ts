import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_PASSWORD_RESET_REQUESTED_EVENT } from '../../domain/audit/audit-events';
import { AuthTokenType, hashAuthToken } from '../../domain/auth/auth-token';
import { SendPasswordResetEmailUseCase } from './send-password-reset-email.use-case';
import {
  FakeAuthTokenRepository,
  FakeEmailSender,
  FakeUserRepository,
  makeUser,
} from './testing-fakes';

describe('SendPasswordResetEmailUseCase', () => {
  let users: FakeUserRepository;
  let tokens: FakeAuthTokenRepository;
  let sender: FakeEmailSender;
  let emit: jest.Mock;

  const BASE = 'https://app.example.com';

  function build(appBaseUrl: string | undefined) {
    return new SendPasswordResetEmailUseCase(
      users,
      tokens,
      sender,
      { appBaseUrl },
      { emit } as unknown as EventEmitter2,
    );
  }

  function buildWithoutBaseUrl() {
    return build(undefined);
  }

  beforeEach(() => {
    users = new FakeUserRepository([makeUser()]);
    tokens = new FakeAuthTokenRepository();
    sender = new FakeEmailSender();
    emit = jest.fn();
  });

  it('mails a reset link whose token is stored only as a hash, valid for one hour', async () => {
    await build(BASE).execute({
      email: 'ada@example.com',
      reason: 'forgot_password',
    });

    expect(sender.sent).toHaveLength(1);
    const raw = /reset-password#token=(\S+)/.exec(sender.sent[0].text)![1];
    expect(tokens.issued[0].type).toBe(AuthTokenType.PasswordReset);
    expect(tokens.issued[0].tokenHash).toBe(hashAuthToken(raw));
    const ttl = tokens.issued[0].expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60_000);
    expect(ttl).toBeLessThanOrEqual(3600_000);
    expect(emit).toHaveBeenCalledWith(AUTH_PASSWORD_RESET_REQUESTED_EVENT, {
      userId: 'user-1',
    });
  });

  it('sends the "already have an account" copy for an existing-account request', async () => {
    await build(BASE).execute({
      email: 'ada@example.com',
      reason: 'existing_account',
    });

    expect(sender.sent[0].subject).toBe('You already have a MemoFlow account');
    expect(sender.sent[0].text).toContain('/reset-password#token=');
  });

  it('sends nothing for an unknown or disabled account', async () => {
    users.users.push(
      makeUser({ id: 'd', email: 'd@example.com', disabledAt: new Date() }),
    );
    await build(BASE).execute({
      email: 'nobody@example.com',
      reason: 'forgot_password',
    });
    await build(BASE).execute({
      email: 'd@example.com',
      reason: 'forgot_password',
    });

    expect(sender.sent).toHaveLength(0);
    expect(tokens.issued).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('sends nothing for a second request inside the issue limit', async () => {
    const input = {
      email: 'ada@example.com',
      reason: 'forgot_password',
    } as const;
    await build(BASE).execute(input);
    await build(BASE).execute(input);

    expect(sender.sent).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('skips when APP_BASE_URL is unset', async () => {
    await buildWithoutBaseUrl().execute({
      email: 'ada@example.com',
      reason: 'forgot_password',
    });

    expect(sender.sent).toHaveLength(0);
    expect(tokens.issued).toHaveLength(0);
  });
});
