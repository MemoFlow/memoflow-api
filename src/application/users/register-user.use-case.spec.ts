import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import {
  AUTH_RESET_LINK_REQUESTED_EVENT,
  AUTH_VERIFICATION_REQUESTED_EVENT,
} from '../../domain/auth/auth-events';
import { UserRole } from '../../domain/users/user-role';
import { FakeUserRepository, makeUser } from '../auth/testing-fakes';
import { RegisterUserUseCase } from './register-user.use-case';

describe('RegisterUserUseCase', () => {
  const input = {
    email: 'ada@example.com',
    password: 'correct-horse-battery-staple',
    displayName: 'Ada Lovelace',
  };
  let repository: FakeUserRepository;
  let emit: jest.Mock;
  let useCase: RegisterUserUseCase;

  beforeEach(() => {
    repository = new FakeUserRepository();
    emit = jest.fn();
    useCase = new RegisterUserUseCase(repository, {
      emit,
    } as unknown as EventEmitter2);
  });

  it('creates an unverified user with a bcrypt hash and requests a verification email', async () => {
    await expect(useCase.execute(input)).resolves.toBeUndefined();

    expect(repository.users).toHaveLength(1);
    const user = repository.users[0];
    expect(user.role).toBe(UserRole.User);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).not.toBe(input.password);
    expect(await bcrypt.compare(input.password, user.passwordHash)).toBe(true);
    expect(emit).toHaveBeenCalledWith(AUTH_VERIFICATION_REQUESTED_EVENT, {
      userId: user.id,
    });
  });

  it('stores the address trimmed and lowercased', async () => {
    await useCase.execute({ ...input, email: '  Ada@Example.COM ' });

    expect(repository.users[0].email).toBe('ada@example.com');
  });

  it('treats an address differing only by case as existing', async () => {
    repository.users.push(makeUser({ passwordHash: 'original' }));

    await expect(
      useCase.execute({ ...input, email: 'ADA@example.com' }),
    ).resolves.toBeUndefined();

    expect(repository.users).toHaveLength(1);
    expect(repository.users[0].passwordHash).toBe('original');
    expect(emit).toHaveBeenCalledWith(AUTH_RESET_LINK_REQUESTED_EVENT, {
      email: 'ada@example.com',
      reason: 'existing_account',
    });
    expect(emit).not.toHaveBeenCalledWith(
      AUTH_VERIFICATION_REQUESTED_EVENT,
      expect.anything(),
    );
  });

  it('ends in the same outcome when the unique constraint loses a race', async () => {
    jest
      .spyOn(repository, 'create')
      .mockRejectedValue(new ConflictException('Email is already registered'));

    await expect(useCase.execute(input)).resolves.toBeUndefined();

    expect(emit).toHaveBeenCalledWith(AUTH_RESET_LINK_REQUESTED_EVENT, {
      email: 'ada@example.com',
      reason: 'existing_account',
    });
  });

  it('rethrows unexpected repository errors', async () => {
    jest.spyOn(repository, 'create').mockRejectedValue(new Error('db down'));

    await expect(useCase.execute(input)).rejects.toThrow('db down');
  });
});
