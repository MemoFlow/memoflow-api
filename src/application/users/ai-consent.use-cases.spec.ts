import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { makeUser } from '../auth/testing-fakes';
import {
  AI_CONSENT_ACCEPTED_EVENT,
  AI_CONSENT_WITHDRAWN_EVENT,
  AI_NOTICE_VERSION,
} from '../../domain/ai/ai-consent';
import { User } from '../../domain/users/user.entity';
import type { UserRepository } from '../../domain/users/user.repository';
import { AcceptAiConsentUseCase } from './accept-ai-consent.use-case';
import { WithdrawAiConsentUseCase } from './withdraw-ai-consent.use-case';

class InMemoryUserRepository {
  constructor(readonly users: User[]) {}

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.id === id) ?? null);
  }

  setAiConsent(
    id: string,
    consentAt: Date | null,
    version: string | null,
  ): Promise<void> {
    const user = this.users.find((u) => u.id === id);
    if (user) {
      user.aiConsentAt = consentAt;
      user.aiConsentVersion = version;
    }
    return Promise.resolve();
  }
}

function setup(users: User[] = [makeUser()]) {
  const repo = new InMemoryUserRepository(users);
  const emitter = new EventEmitter2();
  const emit = jest.spyOn(emitter, 'emit');
  return {
    repo,
    emit,
    accept: new AcceptAiConsentUseCase(
      repo as unknown as UserRepository,
      emitter,
    ),
    withdraw: new WithdrawAiConsentUseCase(
      repo as unknown as UserRepository,
      emitter,
    ),
  };
}

describe('AcceptAiConsentUseCase', () => {
  it('records consent for the current version and emits the audit event', async () => {
    const { accept, emit } = setup();

    const user = await accept.execute({
      userId: 'user-1',
      version: AI_NOTICE_VERSION,
    });

    expect(user.aiConsentVersion).toBe(AI_NOTICE_VERSION);
    expect(user.aiConsentAt).toBeInstanceOf(Date);
    expect(user.hasCurrentAiConsent).toBe(true);
    expect(emit).toHaveBeenCalledWith(AI_CONSENT_ACCEPTED_EVENT, {
      userId: 'user-1',
      version: AI_NOTICE_VERSION,
    });
  });

  it('rejects another version with a 409 and records nothing', async () => {
    const { accept, repo, emit } = setup();

    await expect(
      accept.execute({ userId: 'user-1', version: '2020-01-01' }),
    ).rejects.toThrow(ConflictException);

    expect(repo.users[0].aiConsentAt).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it('refreshes the timestamp when accepting again', async () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const { accept } = setup([
      makeUser({ aiConsentAt: old, aiConsentVersion: AI_NOTICE_VERSION }),
    ]);

    const user = await accept.execute({
      userId: 'user-1',
      version: AI_NOTICE_VERSION,
    });

    expect(user.aiConsentAt!.getTime()).toBeGreaterThan(old.getTime());
  });

  it('throws NotFound for an unknown user', async () => {
    const { accept } = setup([]);
    await expect(
      accept.execute({ userId: 'nope', version: AI_NOTICE_VERSION }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('WithdrawAiConsentUseCase', () => {
  it('clears both columns and emits the audit event', async () => {
    const { withdraw, repo, emit } = setup([
      makeUser({
        aiConsentAt: new Date(),
        aiConsentVersion: AI_NOTICE_VERSION,
      }),
    ]);

    await withdraw.execute('user-1');

    expect(repo.users[0].aiConsentAt).toBeNull();
    expect(repo.users[0].aiConsentVersion).toBeNull();
    expect(emit).toHaveBeenCalledWith(AI_CONSENT_WITHDRAWN_EVENT, {
      userId: 'user-1',
    });
  });

  it('is idempotent when there is no consent to withdraw', async () => {
    const { withdraw, repo } = setup();
    await withdraw.execute('user-1');
    await withdraw.execute('user-1');
    expect(repo.users[0].hasCurrentAiConsent).toBe(false);
  });
});
