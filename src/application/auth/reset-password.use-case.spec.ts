import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { AUTH_PASSWORD_RESET_COMPLETED_EVENT } from '../../domain/audit/audit-events';
import {
  AuthTokenType,
  generateAuthToken,
  hashAuthToken,
} from '../../domain/auth/auth-token';
import { USER_SESSIONS_REVOKED_EVENT } from '../../domain/users/user-events';
import { ResetPasswordUseCase } from './reset-password.use-case';
import {
  FakeAuthTokenRepository,
  FakeUserRepository,
  makeUser,
} from './testing-fakes';

describe('ResetPasswordUseCase', () => {
  let users: FakeUserRepository;
  let tokens: FakeAuthTokenRepository;
  let emit: jest.Mock;
  let useCase: ResetPasswordUseCase;
  let token: string;
  let cleared: string[];
  let limiter: { registerAttempt: jest.Mock; clear: jest.Mock };

  async function issue(userId = 'user-1', ttlMs = 3600_000) {
    token = generateAuthToken();
    await tokens.issue({
      userId,
      type: AuthTokenType.PasswordReset,
      tokenHash: hashAuthToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
      minIntervalMs: 0,
    });
  }

  beforeEach(async () => {
    tokens = new FakeAuthTokenRepository();
    users = new FakeUserRepository([makeUser()], tokens);
    emit = jest.fn();
    cleared = [];
    limiter = {
      registerAttempt: jest.fn(),
      clear: jest.fn((email: string) => {
        cleared.push(email);
        return Promise.resolve();
      }),
    };
    useCase = new ResetPasswordUseCase(
      users,
      { emit } as unknown as EventEmitter2,
      limiter,
    );
    await issue();
  });

  it('clears the account login counter after a successful reset', async () => {
    await useCase.execute({ token, newPassword: 'brand-new-password' });

    expect(cleared).toEqual(['ada@example.com']);
  });

  it('does not clear the counter when the token is invalid', async () => {
    await expect(
      useCase.execute({ token: 'bogus', newPassword: 'brand-new-password' }),
    ).rejects.toThrow(BadRequestException);

    expect(cleared).toEqual([]);
  });

  it('still succeeds when clearing the counter fails', async () => {
    limiter.clear.mockRejectedValue(new Error('redis down'));

    await expect(
      useCase.execute({ token, newPassword: 'brand-new-password' }),
    ).resolves.toBeUndefined();
    expect(users.resets).toHaveLength(1);
  });

  it('sets the new password, bumps the session version and emits revocation + audit events', async () => {
    await useCase.execute({ token, newPassword: 'brand-new-password' });

    expect(users.resets).toHaveLength(1);
    expect(
      await bcrypt.compare('brand-new-password', users.resets[0].hash),
    ).toBe(true);
    expect(users.users[0].tokenVersion).toBe(1);
    expect(users.users[0].emailVerifiedAt).toBeInstanceOf(Date);
    expect(emit).toHaveBeenCalledWith(USER_SESSIONS_REVOKED_EVENT, {
      userId: 'user-1',
    });
    expect(emit).toHaveBeenCalledWith(AUTH_PASSWORD_RESET_COMPLETED_EVENT, {
      userId: 'user-1',
    });
  });

  it('rejects a reused token', async () => {
    await useCase.execute({ token, newPassword: 'brand-new-password' });

    await expect(
      useCase.execute({ token, newPassword: 'another-password' }),
    ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
    expect(users.resets).toHaveLength(1);
  });

  it('rejects an expired, unknown or tampered token with the same error', async () => {
    await issue('user-1', -1000);
    const expired = token;
    for (const bad of [expired, 'unknown', `${token}x`]) {
      await expect(
        useCase.execute({ token: bad, newPassword: 'brand-new-password' }),
      ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
    }
    expect(users.resets).toHaveLength(0);
  });

  it('rejects the same way when the account is disabled', async () => {
    users.users[0].disabledAt = new Date();

    await expect(
      useCase.execute({ token, newPassword: 'brand-new-password' }),
    ).rejects.toThrow(new BadRequestException('Invalid or expired token'));
    expect(users.resets).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
    // The token was not spent: once the account is enabled again it works.
    users.users[0].disabledAt = null;
    await useCase.execute({ token, newPassword: 'brand-new-password' });
    expect(users.resets).toHaveLength(1);
  });

  it('does not spend the token when the update fails', async () => {
    users.failUpdate = new Error('db down');
    await expect(
      useCase.execute({ token, newPassword: 'brand-new-password' }),
    ).rejects.toThrow('db down');

    users.failUpdate = null;
    await useCase.execute({ token, newPassword: 'brand-new-password' });
    expect(users.resets).toHaveLength(1);
  });
});
