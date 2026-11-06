import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_EMAIL_VERIFIED_EVENT } from '../../domain/audit/audit-events';
import {
  AuthTokenType,
  generateAuthToken,
  hashAuthToken,
} from '../../domain/auth/auth-token';
import { VerifyEmailUseCase } from './verify-email.use-case';
import {
  FakeAuthTokenRepository,
  FakeUserRepository,
  makeUser,
} from './testing-fakes';

describe('VerifyEmailUseCase', () => {
  let users: FakeUserRepository;
  let tokens: FakeAuthTokenRepository;
  let emit: jest.Mock;
  let useCase: VerifyEmailUseCase;

  beforeEach(() => {
    tokens = new FakeAuthTokenRepository();
    users = new FakeUserRepository([makeUser()], tokens);
    emit = jest.fn();
    useCase = new VerifyEmailUseCase(users, {
      emit,
    } as unknown as EventEmitter2);
  });

  async function issue(type: AuthTokenType, ttlMs = 3600_000) {
    const token = generateAuthToken();
    await tokens.issue({
      userId: 'user-1',
      type,
      tokenHash: hashAuthToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
      minIntervalMs: 0,
    });
    return token;
  }

  it('marks the email verified and emits the audit event', async () => {
    const token = await issue(AuthTokenType.EmailVerification);

    await useCase.execute({ token });

    expect(users.verified).toEqual(['user-1']);
    expect(emit).toHaveBeenCalledWith(AUTH_EMAIL_VERIFIED_EVENT, {
      userId: 'user-1',
    });
  });

  it('rejects reused, expired, unknown and wrong-type tokens uniformly', async () => {
    const used = await issue(AuthTokenType.EmailVerification);
    await useCase.execute({ token: used });
    const expired = await issue(AuthTokenType.EmailVerification, -1000);
    const resetType = await issue(AuthTokenType.PasswordReset);

    for (const token of [used, expired, resetType, 'unknown']) {
      await expect(useCase.execute({ token })).rejects.toThrow(
        new BadRequestException('Invalid or expired token'),
      );
    }
    expect(users.verified).toHaveLength(1);
  });

  it('rejects a disabled account uniformly and leaves the token unspent', async () => {
    const token = await issue(AuthTokenType.EmailVerification);
    users.users[0].disabledAt = new Date();

    await expect(useCase.execute({ token })).rejects.toThrow(
      new BadRequestException('Invalid or expired token'),
    );
    expect(users.verified).toHaveLength(0);

    users.users[0].disabledAt = null;
    await useCase.execute({ token });
    expect(users.verified).toEqual(['user-1']);
  });
});
