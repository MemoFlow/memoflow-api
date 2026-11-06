import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_LOGOUT_EVENT } from '../../domain/audit/audit-events';
import { USER_SESSIONS_REVOKED_EVENT } from '../../domain/users/user-events';
import { LogoutUserUseCase } from './logout-user.use-case';
import { FakeUserRepository, makeUser } from './testing-fakes';

describe('LogoutUserUseCase', () => {
  it('bumps the token version and emits the revoke and audit events', async () => {
    const user = makeUser({ tokenVersion: 2 });
    const repository = new FakeUserRepository([user]);
    const emit = jest.fn();
    const useCase = new LogoutUserUseCase(repository, {
      emit,
    } as unknown as EventEmitter2);

    await useCase.execute({ userId: user.id });

    expect(user.tokenVersion).toBe(3);
    expect(emit).toHaveBeenCalledWith(USER_SESSIONS_REVOKED_EVENT, {
      userId: user.id,
    });
    expect(emit).toHaveBeenCalledWith(AUTH_LOGOUT_EVENT, { userId: user.id });
  });

  it('emits nothing when the revoke fails', async () => {
    const repository = new FakeUserRepository([]);
    const emit = jest.fn();
    const useCase = new LogoutUserUseCase(repository, {
      emit,
    } as unknown as EventEmitter2);

    await expect(useCase.execute({ userId: 'missing' })).rejects.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });
});
