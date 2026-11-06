import { NotFoundException } from '@nestjs/common';
import { UserRole } from '../../domain/users/user-role';
import { User } from '../../domain/users/user.entity';
import { GetUserByIdUseCase } from './get-user-by-id.use-case';
import { GetUserProfileUseCase } from './get-user-profile.use-case';

function makeUser(id: string, role = UserRole.User): User {
  return new User({
    id,
    email: `${id}@example.com`,
    passwordHash: 'hash',
    displayName: id,
    role,
    xp: 0,
    level: 1,
    lastActiveAt: null,
  });
}

describe('GetUserProfileUseCase', () => {
  const users = [
    makeUser('user-1'),
    makeUser('user-2'),
    makeUser('admin-1', UserRole.Admin),
  ];
  const getUserById = {
    execute: jest.fn((id: string) => {
      const found = users.find((u) => u.id === id);
      return found
        ? Promise.resolve(found)
        : Promise.reject(new NotFoundException());
    }),
  } as unknown as GetUserByIdUseCase;
  const useCase = new GetUserProfileUseCase(getUserById);

  it('returns the actor their own record', async () => {
    const result = await useCase.execute({ actor: users[0], userId: 'user-1' });
    expect(result.id).toBe('user-1');
  });

  it("throws NotFoundException when a non-admin reads another user's record", async () => {
    await expect(
      useCase.execute({ actor: users[0], userId: 'user-2' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lets an admin read any user', async () => {
    const result = await useCase.execute({ actor: users[2], userId: 'user-2' });
    expect(result.id).toBe('user-2');
  });

  it('throws NotFoundException for an unknown id even for an admin', async () => {
    await expect(
      useCase.execute({ actor: users[2], userId: 'missing' }),
    ).rejects.toThrow(NotFoundException);
  });
});
