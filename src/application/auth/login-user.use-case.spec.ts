import { UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  AUTH_LOGIN_EVENT,
  AUTH_LOGIN_FAILED_EVENT,
  AUTH_LOGIN_THROTTLED_EVENT,
} from '../../domain/audit/audit-events';
import { LOGIN_MAX_ATTEMPTS } from '../../domain/auth/login-attempt-limiter.port';
import { UserRole } from '../../domain/users/user-role';
import { User } from '../../domain/users/user.entity';
import {
  LoginAttemptLimiter,
  LoginAttemptResult,
} from '../../domain/auth/login-attempt-limiter.port';
import { UserRepository } from '../../domain/users/user.repository';
import { LoginThrottledException } from './login-throttled.exception';
import { LoginUserUseCase } from './login-user.use-case';

// Wraps the real bcrypt.compare so calls can be counted without faking it.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual<typeof import('bcrypt')>('bcrypt');
  return {
    ...actual,
    compare: jest.fn(actual.compare as (...a: unknown[]) => Promise<boolean>),
  };
});

function makeEventEmitter(): jest.Mocked<Pick<EventEmitter2, 'emit'>> {
  return { emit: jest.fn() };
}

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

  setDisabledAt(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
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

class FakeLimiter implements LoginAttemptLimiter {
  readonly registered: string[] = [];
  readonly cleared: string[] = [];
  result: LoginAttemptResult = {
    allowed: true,
    retryAfterSeconds: 0,
    attempts: 1,
  };

  registerAttempt(email: string): Promise<LoginAttemptResult> {
    this.registered.push(email);
    return Promise.resolve(this.result);
  }

  clear(email: string): Promise<void> {
    this.cleared.push(email);
    return Promise.resolve();
  }
}

describe('LoginUserUseCase', () => {
  let limiter: FakeLimiter;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  let repository: InMemoryUserRepository;
  let jwtService: JwtService;
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let useCase: LoginUserUseCase;
  let user: User;

  beforeEach(async () => {
    (bcrypt.compare as unknown as jest.Mock).mockClear();
    user = new User({
      id: 'user-1',
      email: 'ada@example.com',
      passwordHash: await bcrypt.hash('correct-password', 10),
      displayName: 'Ada Lovelace',
      role: UserRole.User,
      xp: 0,
      level: 1,
      lastActiveAt: null,
    });
    repository = new InMemoryUserRepository([user]);
    jwtService = new JwtService({ secret: 'test-secret' });
    eventEmitter = makeEventEmitter();
    limiter = new FakeLimiter();
    useCase = new LoginUserUseCase(
      repository,
      jwtService,
      eventEmitter as unknown as EventEmitter2,
      limiter,
    );
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

  it('matches the address case-insensitively and embeds the session version', async () => {
    user.tokenVersion = 3;

    const result = await useCase.execute({
      email: '  Ada@Example.COM ',
      password: 'correct-password',
    });

    expect(jwtService.verify(result.accessToken)).toMatchObject({
      sub: 'user-1',
      tv: 3,
    });
  });

  it('updates last_active_at on successful login', async () => {
    await useCase.execute({
      email: 'ada@example.com',
      password: 'correct-password',
    });

    expect(repository.updatedLastActiveAtIds).toEqual(['user-1']);
  });

  it('emits auth.login with the userId on success', async () => {
    await useCase.execute({
      email: 'ada@example.com',
      password: 'correct-password',
    });

    expect(eventEmitter.emit).toHaveBeenCalledWith(AUTH_LOGIN_EVENT, {
      userId: 'user-1',
    });
  });

  it('rejects an unknown email and emits auth.login_failed with a null userId', async () => {
    await expect(
      useCase.execute({ email: 'unknown@example.com', password: 'whatever' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(repository.updatedLastActiveAtIds).toEqual([]);
    expect(eventEmitter.emit).toHaveBeenCalledWith(AUTH_LOGIN_FAILED_EVENT, {
      userId: null,
      email: 'unknown@example.com',
    });
  });

  it('rejects an incorrect password, does not update last_active_at, and emits auth.login_failed with the userId', async () => {
    await expect(
      useCase.execute({ email: 'ada@example.com', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(repository.updatedLastActiveAtIds).toEqual([]);
    expect(eventEmitter.emit).toHaveBeenCalledWith(AUTH_LOGIN_FAILED_EVENT, {
      userId: 'user-1',
      email: 'ada@example.com',
    });
  });

  it('rejects a disabled account with the same error, even with the correct password, and emits auth.login_failed', async () => {
    user.disabledAt = new Date();

    await expect(
      useCase.execute({
        email: 'ada@example.com',
        password: 'correct-password',
      }),
    ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));

    expect(repository.updatedLastActiveAtIds).toEqual([]);
    expect(eventEmitter.emit).toHaveBeenCalledWith(AUTH_LOGIN_FAILED_EVENT, {
      userId: 'user-1',
      email: 'ada@example.com',
    });
  });

  describe('per-account throttle', () => {
    it('counts the normalized email and clears the counter on success', async () => {
      await useCase.execute({
        email: '  Ada@Example.COM ',
        password: 'correct-password',
      });

      expect(limiter.registered).toEqual(['ada@example.com']);
      expect(limiter.cleared).toEqual(['ada@example.com']);
    });

    it('does not clear the counter after a failed login', async () => {
      await expect(
        useCase.execute({ email: 'ada@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(limiter.registered).toEqual(['ada@example.com']);
      expect(limiter.cleared).toEqual([]);
    });

    it('counts unknown emails too', async () => {
      await expect(
        useCase.execute({ email: 'ghost@example.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(limiter.registered).toEqual(['ghost@example.com']);
    });

    it('throws LoginThrottledException without touching the repository or bcrypt when blocked', async () => {
      limiter.result = {
        allowed: false,
        retryAfterSeconds: 42,
        attempts: LOGIN_MAX_ATTEMPTS + 2,
      };
      const findByEmail = jest.spyOn(repository, 'findByEmail');
      const compare = bcrypt.compare as unknown as jest.Mock;

      const err: unknown = await useCase
        .execute({ email: 'ada@example.com', password: 'correct-password' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(LoginThrottledException);
      expect((err as LoginThrottledException).retryAfterSeconds).toBe(42);
      expect((err as LoginThrottledException).getStatus()).toBe(429);
      expect(findByEmail).not.toHaveBeenCalled();
      expect(compare).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('emits auth.login_throttled only on the first blocked attempt of a window', async () => {
      limiter.result = {
        allowed: false,
        retryAfterSeconds: 42,
        attempts: LOGIN_MAX_ATTEMPTS + 1,
      };

      await expect(
        useCase.execute({ email: ' Ada@Example.com ', password: 'x' }),
      ).rejects.toThrow(LoginThrottledException);

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AUTH_LOGIN_THROTTLED_EVENT,
        { userId: null, email: 'ada@example.com' },
      );
    });
  });

  describe('uniform timing', () => {
    it('runs a bcrypt compare against a cost-10 hash for an unknown email', async () => {
      const compare = bcrypt.compare as unknown as jest.Mock;

      await expect(
        useCase.execute({ email: 'ghost@example.com', password: 'x' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));

      expect(compare).toHaveBeenCalledTimes(1);
      const hash = (compare.mock.calls[0] as unknown[])[1] as string;
      expect(bcrypt.getRounds(hash)).toBe(10);
    });

    it('runs exactly one compare for a known account and for a disabled one', async () => {
      const compare = bcrypt.compare as unknown as jest.Mock;
      await expect(
        useCase.execute({ email: 'ada@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
      user.disabledAt = new Date();
      await expect(
        useCase.execute({
          email: 'ada@example.com',
          password: 'correct-password',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(compare).toHaveBeenCalledTimes(2);
    });
  });
});
