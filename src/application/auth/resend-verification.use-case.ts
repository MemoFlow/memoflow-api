import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_VERIFICATION_REQUESTED_EVENT } from '../../domain/auth/auth-events';
import type { AuthVerificationRequestedEventPayload } from '../../domain/auth/auth-events';
import { User } from '../../domain/users/user.entity';

/**
 * Asks for a new verification email. A no-op for verified accounts; the
 * per-account issue limit is enforced when the email is actually sent.
 */
@Injectable()
export class ResendVerificationUseCase {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  execute(input: { user: User }): void {
    if (input.user.isEmailVerified) return;
    const payload: AuthVerificationRequestedEventPayload = {
      userId: input.user.id,
    };
    this.eventEmitter.emit(AUTH_VERIFICATION_REQUESTED_EVENT, payload);
  }
}
