import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { AUTH_PASSWORD_RESET_COMPLETED_EVENT } from '../../domain/audit/audit-events';
import type { AuthAccountEventPayload } from '../../domain/audit/audit-events';
import { hashAuthToken } from '../../domain/auth/auth-token';
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
  ) {}

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

    const revoked: UserSessionsRevokedEventPayload = { userId };
    this.eventEmitter.emit(USER_SESSIONS_REVOKED_EVENT, revoked);
    const audit: AuthAccountEventPayload = { userId };
    this.eventEmitter.emit(AUTH_PASSWORD_RESET_COMPLETED_EVENT, audit);
  }
}
