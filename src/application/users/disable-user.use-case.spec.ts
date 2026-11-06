import { EventEmitter2 } from '@nestjs/event-emitter';
import { USER_DISABLED_EVENT } from '../../domain/users/user-events';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../domain/users/user-role';
import { User } from '../../domain/users/user.entity';
import { UserRepository } from '../../domain/users/user.repository';
import { DisableUserUseCase } from './disable-user.use-case';

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

describe('DisableUserUseCase', () => {
  let emitter: { emit: jest.Mock };

  beforeEach(() => {
    emitter = { emit: jest.fn() };
  });

  it('sets disabledAt on an active user', async () => {
    const repository = new InMemoryUserRepository([makeUser('user-1')]);
    const useCase = new DisableUserUseCase(
      repository,
      emitter as unknown as EventEmitter2,
    );

    await useCase.execute({
      actorId: 'admin-1',
      role: UserRole.Admin,
      userId: 'user-1',
    });

    expect(repository.setCalls).toHaveLength(1);
    expect(repository.setCalls[0].id).toBe('user-1');
    expect(repository.setCalls[0].disabledAt).toBeInstanceOf(Date);
    expect(emitter.emit).toHaveBeenCalledWith(USER_DISABLED_EVENT, {
      userId: 'user-1',
      actorId: 'admin-1',
    });
  });

  it('keeps the original timestamp but still emits the event for an already disabled user', async () => {
    const repository = new InMemoryUserRepository([
      makeUser('user-1', new Date()),
    ]);
    const useCase = new DisableUserUseCase(
      repository,
      emitter as unknown as EventEmitter2,
    );

    await useCase.execute({
      actorId: 'admin-1',
      role: UserRole.Admin,
      userId: 'user-1',
    });

    expect(repository.setCalls).toEqual([]);
    expect(emitter.emit).toHaveBeenCalledWith(USER_DISABLED_EVENT, {
      userId: 'user-1',
      actorId: 'admin-1',
    });
  });

  it('throws NotFoundException for an unknown user', async () => {
    const useCase = new DisableUserUseCase(
      new InMemoryUserRepository([]),
      emitter as unknown as EventEmitter2,
    );

    await expect(
      useCase.execute({
        actorId: 'admin-1',
        role: UserRole.Admin,
        userId: 'missing',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when the actor disables themselves', async () => {
    const repository = new InMemoryUserRepository([makeUser('admin-1')]);
    const useCase = new DisableUserUseCase(
      repository,
      emitter as unknown as EventEmitter2,
    );

    await expect(
      useCase.execute({
        actorId: 'admin-1',
        role: UserRole.Admin,
        userId: 'admin-1',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.setCalls).toEqual([]);
  });

  it('throws ForbiddenException for a non-admin actor', async () => {
    const repository = new InMemoryUserRepository([makeUser('user-1')]);
    const useCase = new DisableUserUseCase(
      repository,
      emitter as unknown as EventEmitter2,
    );

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
