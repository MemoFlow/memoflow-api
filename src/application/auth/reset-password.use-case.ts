import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { AUTH_PASSWORD_RESET_COMPLETED_EVENT } from '../../domain/audit/audit-events';
import type { AuthAccountEventPayload } from '../../domain/audit/audit-events';
import { hashAuthToken } from '../../domain/auth/auth-token';
import { LOGIN_ATTEMPT_LIMITER } from '../../domain/auth/login-attempt-limiter.port';
import type { LoginAttemptLimiter } from '../../domain/auth/login-attempt-limiter.port';
import { normalizeEmail } from '../../domain/users/normalize-email';
import { USER_SESSIONS_REVOKED_EVENT } from '../../domain/users/user-events';
import type { UserSessionsRevokedEventPayload } from '../../domain/users/user-events';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';

const BCRYPT_SALT_ROUNDS = 10;

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

@Injectable()
export class ResetPasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
    @Inject(LOGIN_ATTEMPT_LIMITER)
    private readonly attemptLimiter: LoginAttemptLimiter,
  ) {}

  private readonly logger = new Logger(ResetPasswordUseCase.name);

  async execute(input: ResetPasswordInput): Promise<void> {
    // Hash before the transaction so bcrypt never holds it open.
    const passwordHash = await bcrypt.hash(
      input.newPassword,
      BCRYPT_SALT_ROUNDS,
    );
    // Token consumption and the password update commit together; an unknown,
    // used, expired or disabled-account case changes nothing and looks the
    // same to the caller.
    const userId = await this.userRepository.resetPasswordWithToken(
      hashAuthToken(input.token),
      passwordHash,
      new Date(),
    );
    if (!userId) {
      throw new BadRequestException('Invalid or expired token');
    }

    await this.clearLoginCounter(userId);

    const revoked: UserSessionsRevokedEventPayload = { userId };
    this.eventEmitter.emit(USER_SESSIONS_REVOKED_EVENT, revoked);
    const audit: AuthAccountEventPayload = { userId };
    this.eventEmitter.emit(AUTH_PASSWORD_RESET_COMPLETED_EVENT, audit);
  }

  /**
   * Completing a reset proves ownership of the mailbox, so a locked-out owner
   * must not stay locked out. Best effort: never fails the reset.
   */
  private async clearLoginCounter(userId: string): Promise<void> {
    try {
      const user = await this.userRepository.findById(userId);
      if (user) await this.attemptLimiter.clear(normalizeEmail(user.email));
    } catch {
      this.logger.warn('Could not clear the login attempt counter after reset');
    }
  }
}
