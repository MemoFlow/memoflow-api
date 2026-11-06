import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { USER_ENABLED_EVENT } from '../../domain/users/user-events';
import { UserRole } from '../../domain/users/user-role';
import { User } from '../../domain/users/user.entity';
import { UserRepository } from '../../domain/users/user.repository';
import { EnableUserUseCase } from './enable-user.use-case';

class InMemoryUserRepository implements UserRepository {
  readonly setCalls: { id: string; disabledAt: Date | null }[] = [];

  constructor(private readonly users: User[] = []) {}

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.id === id) ?? null);
  }

  findByEmail(): Promise<User | null> {
    return Promise.reject(new Error('not implemented'));
  }

  create(): Promise<User> {
    return Promise.reject(new Error('not implemented'));
  }

  updateLastActiveAt(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  setAiConsent(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  setDisabledAt(id: string, disabledAt: Date | null): Promise<void> {
    this.setCalls.push({ id, disabledAt });
    return Promise.resolve();
  }

  markEmailVerified(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  changePassword(): Promise<number> {
    return Promise.reject(new Error('not implemented'));
  }

  resetPassword(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  findTopByXp(): Promise<User[]> {
    return Promise.reject(new Error('not implemented'));
  }
}

function makeUser(id: string, disabledAt: Date | null = null): User {
  return new User({
    id,
    email: `${id}@example.com`,
    passwordHash: 'hash',
    displayName: id,
    role: UserRole.User,
    xp: 0,
    level: 1,
    lastActiveAt: null,
    disabledAt,
  });
}

describe('EnableUserUseCase', () => {
  const emit = jest.fn();
  const emitter = { emit } as unknown as EventEmitter2;

  beforeEach(() => emit.mockClear());

  it('clears disabledAt on a disabled user', async () => {
    const repository = new InMemoryUserRepository([
      makeUser('user-1', new Date()),
    ]);
    const useCase = new EnableUserUseCase(repository, emitter);

    await useCase.execute({
      actorId: 'admin-1',
      role: UserRole.Admin,
      userId: 'user-1',
    });

    expect(repository.setCalls).toEqual([{ id: 'user-1', disabledAt: null }]);
    expect(emit).toHaveBeenCalledWith(USER_ENABLED_EVENT, {
      userId: 'user-1',
      actorId: 'admin-1',
    });
  });

  it('is idempotent for an already active user', async () => {
    const repository = new InMemoryUserRepository([makeUser('user-1')]);
    const useCase = new EnableUserUseCase(repository, emitter);

    await useCase.execute({
      actorId: 'admin-1',
      role: UserRole.Admin,
      userId: 'user-1',
    });

    expect(repository.setCalls).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for an unknown user', async () => {
    const useCase = new EnableUserUseCase(
      new InMemoryUserRepository([]),
      emitter,
    );

    await expect(
      useCase.execute({
        actorId: 'admin-1',
        role: UserRole.Admin,
        userId: 'missing',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException for a non-admin actor', async () => {
    const repository = new InMemoryUserRepository([
      makeUser('user-1', new Date()),
    ]);
    const useCase = new EnableUserUseCase(repository, emitter);

    await expect(
      useCase.execute({
        actorId: 'user-2',
        role: UserRole.User,
        userId: 'user-1',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(repository.setCalls).toEqual([]);
  });
});
