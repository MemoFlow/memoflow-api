import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../../domain/users/user.entity';
import { UserRepository } from '../../domain/users/user.repository';
import { LoginUserUseCase } from './login-user.use-case';

class InMemoryUserRepository implements UserRepository {
  readonly updatedLastActiveAtIds: string[] = [];

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

  updateLastActiveAt(id: string): Promise<void> {
    this.updatedLastActiveAtIds.push(id);
    return Promise.resolve();
  }
}

describe('LoginUserUseCase', () => {
  let repository: InMemoryUserRepository;
  let jwtService: JwtService;
  let useCase: LoginUserUseCase;
  let user: User;

  beforeEach(async () => {
    user = new User({
      id: 'user-1',
      email: 'ada@example.com',
      passwordHash: await bcrypt.hash('correct-password', 10),
      displayName: 'Ada Lovelace',
      role: 'user',
      xp: 0,
      level: 1,
      lastActiveAt: null,
    });
    repository = new InMemoryUserRepository([user]);
    jwtService = new JwtService({ secret: 'test-secret' });
    useCase = new LoginUserUseCase(repository, jwtService);
  });

  it('returns an access token for valid credentials', async () => {
    const result = await useCase.execute({
      email: 'ada@example.com',
      password: 'correct-password',
    });

    expect(result.accessToken).toEqual(expect.any(String));
    const decoded = jwtService.verify(result.accessToken);
    expect(decoded).toMatchObject({ sub: 'user-1', email: 'ada@example.com' });
  });

  it('updates last_active_at on successful login', async () => {
    await useCase.execute({
      email: 'ada@example.com',
      password: 'correct-password',
    });

    expect(repository.updatedLastActiveAtIds).toEqual(['user-1']);
  });

  it('rejects an unknown email', async () => {
    await expect(
      useCase.execute({ email: 'unknown@example.com', password: 'whatever' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(repository.updatedLastActiveAtIds).toEqual([]);
  });

  it('rejects an incorrect password and does not update last_active_at', async () => {
    await expect(
      useCase.execute({ email: 'ada@example.com', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(repository.updatedLastActiveAtIds).toEqual([]);
  });
});
