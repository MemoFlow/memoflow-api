import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { User } from '../../domain/users/user.entity';
import {
  CreateUserData,
  UserRepository,
} from '../../domain/users/user.repository';
import { RegisterUserUseCase } from './register-user.use-case';

class InMemoryUserRepository implements UserRepository {
  private readonly users: User[] = [];

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.id === id) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.email === email) ?? null);
  }

  create(data: CreateUserData): Promise<User> {
    const user = new User({
      id: randomUUID(),
      email: data.email,
      passwordHash: data.passwordHash,
      displayName: data.displayName,
      role: 'user',
      xp: 0,
      level: 1,
      lastActiveAt: new Date(),
    });
    this.users.push(user);
    return Promise.resolve(user);
  }

  updateLastActiveAt(): Promise<void> {
    return Promise.resolve();
  }

  findTopByXp(): Promise<User[]> {
    return Promise.reject(new Error('not implemented'));
  }
}

describe('RegisterUserUseCase', () => {
  let repository: InMemoryUserRepository;
  let useCase: RegisterUserUseCase;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
    useCase = new RegisterUserUseCase(repository);
  });

  it('creates a new user with a bcrypt-hashed password', async () => {
    const user = await useCase.execute({
      email: 'ada@example.com',
      password: 'super-secret-1',
      displayName: 'Ada Lovelace',
    });

    expect(user.email).toBe('ada@example.com');
    expect(user.displayName).toBe('Ada Lovelace');
    expect(user.role).toBe('user');
    expect(user.xp).toBe(0);
    expect(user.level).toBe(1);
    expect(user.passwordHash).not.toBe('super-secret-1');
    expect(user.passwordHash.startsWith('$2')).toBe(true);
  });

  it('rejects duplicate emails with ConflictException', async () => {
    await useCase.execute({
      email: 'ada@example.com',
      password: 'super-secret-1',
      displayName: 'Ada Lovelace',
    });

    await expect(
      useCase.execute({
        email: 'ada@example.com',
        password: 'another-password',
        displayName: 'Someone Else',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
