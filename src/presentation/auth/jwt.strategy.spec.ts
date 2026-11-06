import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../domain/users/user-role';
import { User } from '../../domain/users/user.entity';
import { JwtStrategy } from './jwt.strategy';

function makeUser(disabledAt: Date | null = null): User {
  return new User({
    id: 'user-1',
    email: 'ada@example.com',
    passwordHash: 'hash',
    displayName: 'Ada',
    role: UserRole.User,
    xp: 0,
    level: 1,
    lastActiveAt: null,
    disabledAt,
  });
}

describe('JwtStrategy.validate', () => {
  const config = {
    getOrThrow: () => 'test-secret',
  } as unknown as ConfigService;

  it('returns the user for an active account', async () => {
    const user = makeUser();
    const strategy = new JwtStrategy(config, {
      execute: jest.fn().mockResolvedValue(user),
    } as any);

    await expect(
      strategy.validate({ sub: 'user-1', email: 'ada@example.com' }),
    ).resolves.toBe(user);
  });

  it('throws UnauthorizedException for a disabled account', async () => {
    const strategy = new JwtStrategy(config, {
      execute: jest.fn().mockResolvedValue(makeUser(new Date())),
    } as any);

    await expect(
      strategy.validate({ sub: 'user-1', email: 'ada@example.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('maps a missing user to UnauthorizedException', async () => {
    const strategy = new JwtStrategy(config, {
      execute: jest.fn().mockRejectedValue(new NotFoundException()),
    } as any);

    await expect(
      strategy.validate({ sub: 'user-1', email: 'ada@example.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rethrows unexpected errors', async () => {
    const boom = new Error('db down');
    const strategy = new JwtStrategy(config, {
      execute: jest.fn().mockRejectedValue(boom),
    } as any);

    await expect(
      strategy.validate({ sub: 'user-1', email: 'ada@example.com' }),
    ).rejects.toBe(boom);
  });
});
