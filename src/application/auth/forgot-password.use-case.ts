import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_RESET_LINK_REQUESTED_EVENT } from '../../domain/auth/auth-events';
import type { AuthResetLinkRequestedEventPayload } from '../../domain/auth/auth-events';
import { normalizeEmail } from '../../domain/users/normalize-email';

/**
 * Normalizes the address and hands off to the listener. No lookup happens on
 * the request path, so response and timing are identical for every address.
 */
@Injectable()
export class ForgotPasswordUseCase {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  execute(input: { email: string }): void {
    const payload: AuthResetLinkRequestedEventPayload = {
      email: normalizeEmail(input.email),
      reason: 'forgot_password',
    };
    this.eventEmitter.emit(AUTH_RESET_LINK_REQUESTED_EVENT, payload);
  }
}
