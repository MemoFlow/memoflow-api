import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AUTH_PASSWORD_CHANGED_EVENT } from '../../domain/audit/audit-events';
import type { AuthAccountEventPayload } from '../../domain/audit/audit-events';
import { USER_SESSIONS_REVOKED_EVENT } from '../../domain/users/user-events';
import type { UserSessionsRevokedEventPayload } from '../../domain/users/user-events';
import { User } from '../../domain/users/user.entity';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';
import { JwtPayload } from './jwt-payload.interface';

const BCRYPT_SALT_ROUNDS = 10;

export interface ChangePasswordInput {
  user: User;
  currentPassword: string;
  newPassword: string;
}

@Injectable()
export class ChangePasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Returns a fresh access token so the caller's own session continues. */
  async execute(input: ChangePasswordInput): Promise<{ accessToken: string }> {
    const { user } = input;
    const matches = await bcrypt.compare(
      input.currentPassword,
      user.passwordHash,
    );
    if (!matches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(
      input.newPassword,
      BCRYPT_SALT_ROUNDS,
    );
    const tokenVersion = await this.userRepository.changePassword(
      user.id,
      passwordHash,
    );

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tv: tokenVersion,
    };
    const accessToken = await this.jwtService.signAsync(payload);

    const revoked: UserSessionsRevokedEventPayload = { userId: user.id };
    this.eventEmitter.emit(USER_SESSIONS_REVOKED_EVENT, revoked);
    const audit: AuthAccountEventPayload = { userId: user.id };
    this.eventEmitter.emit(AUTH_PASSWORD_CHANGED_EVENT, audit);

    return { accessToken };
  }
}
