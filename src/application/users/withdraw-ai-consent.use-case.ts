import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AI_CONSENT_WITHDRAWN_EVENT } from '../../domain/ai/ai-consent';
import type { AiConsentWithdrawnEventPayload } from '../../domain/ai/ai-consent';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';

/** Clears both consent columns. Idempotent: withdrawing twice is fine. */
@Injectable()
export class WithdrawAiConsentUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(userId: string): Promise<void> {
    await this.userRepository.setAiConsent(userId, null, null);
    const payload: AiConsentWithdrawnEventPayload = { userId };
    this.eventEmitter.emit(AI_CONSENT_WITHDRAWN_EVENT, payload);
  }
}
