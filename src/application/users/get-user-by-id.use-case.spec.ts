import { NotFoundException } from '@nestjs/common';
import { User } from '../../domain/users/user.entity';
import { UserRepository } from '../../domain/users/user.repository';
import { GetUserByIdUseCase } from './get-user-by-id.use-case';

class InMemoryUserRepository implements UserRepository {
  constructor(private readonly users: User[] = []) {}

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.id === id) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.email === email) ?? null);
  }

  create(): Promise<User> {
    return Promise.reject(new Error('not implemented'));
  }

  updateLastActiveAt(): Promise<void> {
    return Promise.resolve();
  }
}

describe('GetUserByIdUseCase', () => {
  it('returns the user when found', async () => {
    const existing = new User({
      id: 'user-1',
      email: 'ada@example.com',
      passwordHash: 'hashed',
      displayName: 'Ada Lovelace',
      role: 'user',
      xp: 0,
      level: 1,
      lastActiveAt: null,
    });
    const useCase = new GetUserByIdUseCase(
      new InMemoryUserRepository([existing]),
    );

    const result = await useCase.execute('user-1');
    expect(result).toBe(existing);
  });

  it('throws NotFoundException when the user does not exist', async () => {
    const useCase = new GetUserByIdUseCase(new InMemoryUserRepository([]));

    await expect(useCase.execute('missing-id')).rejects.toThrow(
      NotFoundException,
    );
  });
});
