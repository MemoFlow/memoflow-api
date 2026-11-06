import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AUTH_PASSWORD_CHANGED_EVENT } from '../../domain/audit/audit-events';
import { USER_SESSIONS_REVOKED_EVENT } from '../../domain/users/user-events';
import { ChangePasswordUseCase } from './change-password.use-case';
import { FakeUserRepository, makeUser } from './testing-fakes';

describe('ChangePasswordUseCase', () => {
  let users: FakeUserRepository;
  let emit: jest.Mock;
  let jwt: JwtService;
  let useCase: ChangePasswordUseCase;

  beforeEach(async () => {
    users = new FakeUserRepository([
      makeUser({ passwordHash: await bcrypt.hash('current-password', 4) }),
    ]);
    emit = jest.fn();
    jwt = new JwtService({ secret: 'test-secret' });
    useCase = new ChangePasswordUseCase(users, jwt, {
      emit,
    } as unknown as EventEmitter2);
  });

  it('rejects a wrong current password and changes nothing', async () => {
    await expect(
      useCase.execute({
        user: users.users[0],
        currentPassword: 'wrong',
        newPassword: 'brand-new-password',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(users.passwordChanges).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('stores the new hash and returns a token carrying the bumped version', async () => {
    const result = await useCase.execute({
      user: users.users[0],
      currentPassword: 'current-password',
      newPassword: 'brand-new-password',
    });

    expect(
      await bcrypt.compare('brand-new-password', users.passwordChanges[0].hash),
    ).toBe(true);
    expect(jwt.verify(result.accessToken)).toMatchObject({
      sub: 'user-1',
      tv: 1,
    });
    expect(emit).toHaveBeenCalledWith(USER_SESSIONS_REVOKED_EVENT, {
      userId: 'user-1',
    });
    expect(emit).toHaveBeenCalledWith(AUTH_PASSWORD_CHANGED_EVENT, {
      userId: 'user-1',
    });
  });
});
