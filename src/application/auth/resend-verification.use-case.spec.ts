import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_VERIFICATION_REQUESTED_EVENT } from '../../domain/auth/auth-events';
import { ResendVerificationUseCase } from './resend-verification.use-case';
import { makeUser } from './testing-fakes';

describe('ResendVerificationUseCase', () => {
  it('emits a verification request for an unverified account', () => {
    const emit = jest.fn();
    new ResendVerificationUseCase({ emit } as unknown as EventEmitter2).execute(
      { user: makeUser() },
    );
    expect(emit).toHaveBeenCalledWith(AUTH_VERIFICATION_REQUESTED_EVENT, {
      userId: 'user-1',
    });
  });

  it('does nothing for an already verified account', () => {
    const emit = jest.fn();
    new ResendVerificationUseCase({ emit } as unknown as EventEmitter2).execute(
      { user: makeUser({ emailVerifiedAt: new Date() }) },
    );
    expect(emit).not.toHaveBeenCalled();
  });
});
