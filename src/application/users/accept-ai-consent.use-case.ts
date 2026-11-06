import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AI_CONSENT_ACCEPTED_EVENT,
  AI_CONSENT_VERSION_MISMATCH_MESSAGE,
  AI_NOTICE_VERSION,
} from '../../domain/ai/ai-consent';
import type { AiConsentAcceptedEventPayload } from '../../domain/ai/ai-consent';
import { User } from '../../domain/users/user.entity';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';

export interface AcceptAiConsentInput {
  userId: string;
  /** The notice version the user says they saw. */
  version: string;
}

/**
 * Records consent to the current AI notice. A version other than the
 * current one is a 409, so nobody consents to a notice they did not see.
 * Accepting again refreshes the timestamp.
 */
@Injectable()
export class AcceptAiConsentUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: AcceptAiConsentInput): Promise<User> {
    if (input.version !== AI_NOTICE_VERSION) {
      throw new ConflictException(AI_CONSENT_VERSION_MISMATCH_MESSAGE);
    }
    await this.userRepository.setAiConsent(
      input.userId,
      new Date(),
      AI_NOTICE_VERSION,
    );
    const user = await this.userRepository.findById(input.userId);
    if (!user) throw new NotFoundException(`User ${input.userId} not found`);
    const payload: AiConsentAcceptedEventPayload = {
      userId: input.userId,
      version: AI_NOTICE_VERSION,
    };
    this.eventEmitter.emit(AI_CONSENT_ACCEPTED_EVENT, payload);
    return user;
  }
}
