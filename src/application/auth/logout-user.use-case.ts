import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_LOGOUT_EVENT } from '../../domain/audit/audit-events';
import type { AuthAccountEventPayload } from '../../domain/audit/audit-events';
import { USER_SESSIONS_REVOKED_EVENT } from '../../domain/users/user-events';
import type { UserSessionsRevokedEventPayload } from '../../domain/users/user-events';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';

/**
 * Logout ends every session of the user (access tokens are stateless, so the
 * only revocation lever is the per-user `token_version`), and drops their
 * live sockets.
 */
@Injectable()
export class LogoutUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: { userId: string }): Promise<void> {
    await this.userRepository.revokeSessions(input.userId);

    const revoked: UserSessionsRevokedEventPayload = { userId: input.userId };
    this.eventEmitter.emit(USER_SESSIONS_REVOKED_EVENT, revoked);
    const audit: AuthAccountEventPayload = { userId: input.userId };
    this.eventEmitter.emit(AUTH_LOGOUT_EVENT, audit);
  }
}
