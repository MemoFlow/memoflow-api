import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_EMAIL_VERIFIED_EVENT } from '../../domain/audit/audit-events';
import type { AuthAccountEventPayload } from '../../domain/audit/audit-events';
import { hashAuthToken } from '../../domain/auth/auth-token';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';

@Injectable()
export class VerifyEmailUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: { token: string }): Promise<void> {
    const userId = await this.userRepository.verifyEmailWithToken(
      hashAuthToken(input.token),
      new Date(),
    );
    if (!userId) {
      throw new BadRequestException('Invalid or expired token');
    }

    const audit: AuthAccountEventPayload = { userId };
    this.eventEmitter.emit(AUTH_EMAIL_VERIFIED_EVENT, audit);
  }
}
