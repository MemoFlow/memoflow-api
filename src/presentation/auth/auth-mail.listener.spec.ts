import { Logger } from '@nestjs/common';
import { SendPasswordResetEmailUseCase } from '../../application/auth/send-password-reset-email.use-case';
import { SendVerificationEmailUseCase } from '../../application/auth/send-verification-email.use-case';
import { AuthMailListener } from './auth-mail.listener';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

describe('AuthMailListener', () => {
  let verification: { execute: jest.Mock };
  let reset: { execute: jest.Mock };
  let listener: AuthMailListener;

  beforeEach(() => {
    verification = { execute: jest.fn().mockResolvedValue(undefined) };
    reset = { execute: jest.fn().mockResolvedValue(undefined) };
    listener = new AuthMailListener(
      verification as unknown as SendVerificationEmailUseCase,
      reset as unknown as SendPasswordResetEmailUseCase,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('delegates verification and reset requests to their use-cases', async () => {
    await listener.onVerificationRequested({ userId: 'u1' });
    await listener.onResetLinkRequested({
      email: 'a@b.com',
      reason: 'forgot_password',
    });

    expect(verification.execute).toHaveBeenCalledWith('u1');
    expect(reset.execute).toHaveBeenCalledWith({
      email: 'a@b.com',
      reason: 'forgot_password',
    });
  });

  it('swallows failures and logs without the address', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    reset.execute.mockRejectedValue(new Error('provider down'));

    await expect(
      listener.onResetLinkRequested({
        email: 'a@b.com',
        reason: 'forgot_password',
      }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).not.toContain('a@b.com');
  });
});
