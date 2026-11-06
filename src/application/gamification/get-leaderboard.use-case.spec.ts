import { UserRole } from '../../domain/users/user-role';
import { User } from '../../domain/users/user.entity';
import { UserRepository } from '../../domain/users/user.repository';
import { GetLeaderboardUseCase } from './get-leaderboard.use-case';

class InMemoryUserRepository implements UserRepository {
  public requestedLimits: number[] = [];

  constructor(private readonly users: User[] = []) {}

  findById(): Promise<User | null> {
    return Promise.reject(new Error('not implemented'));
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

  setDisabledAt(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  findTopByXp(limit: number): Promise<User[]> {
    this.requestedLimits.push(limit);
    return Promise.resolve(
      [...this.users].sort((a, b) => b.xp - a.xp).slice(0, limit),
    );
  }
}

function makeUser(overrides: Partial<User> = {}): User {
  return new User({
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'hash',
    displayName: 'Test User',
    role: UserRole.User,
    xp: 0,
    level: 1,
    lastActiveAt: null,
    ...overrides,
  });
}

describe('GetLeaderboardUseCase', () => {
  it('projects only non-sensitive fields (never email, passwordHash or user id)', async () => {
    const user = makeUser({ id: 'user-1', xp: 200, level: 3 });
    const repository = new InMemoryUserRepository([user]);
    const useCase = new GetLeaderboardUseCase(repository);

    const result = await useCase.execute('user-1');

    expect(result).toEqual([
      { isMe: true, displayName: 'Test User', xp: 200, level: 3 },
    ]);
  });

  it('defaults the limit to 10 when none is given', async () => {
    const repository = new InMemoryUserRepository([]);
    const useCase = new GetLeaderboardUseCase(repository);

    await useCase.execute('viewer');

    expect(repository.requestedLimits).toEqual([10]);
  });

  it('clamps a requested limit above 50 down to 50', async () => {
    const repository = new InMemoryUserRepository([]);
    const useCase = new GetLeaderboardUseCase(repository);

    await useCase.execute('viewer', 500);

    expect(repository.requestedLimits).toEqual([50]);
  });

  it('clamps a requested limit below 1 up to 1', async () => {
    const repository = new InMemoryUserRepository([]);
    const useCase = new GetLeaderboardUseCase(repository);

    await useCase.execute('viewer', 0);

    expect(repository.requestedLimits).toEqual([1]);
  });

  it('flags only the requesting user as isMe', async () => {
    const repository = new InMemoryUserRepository([
      makeUser({ id: 'user-1', xp: 200 }),
      makeUser({ id: 'user-2', xp: 100, displayName: 'Other' }),
    ]);
    const useCase = new GetLeaderboardUseCase(repository);

    const result = await useCase.execute('user-2');

    expect(result.map((entry) => entry.isMe)).toEqual([false, true]);
  });
});
