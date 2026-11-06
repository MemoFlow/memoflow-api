import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PROMPT_ACTIVATED_EVENT } from '../../domain/audit/audit-events';
import type { PromptAuditEventPayload } from '../../domain/audit/audit-events';
import { Prompt } from '../../domain/ai/prompt.entity';
import {
  PROMPT_REPOSITORY,
  PromptActivationConflictError,
} from '../../domain/ai/prompt.repository';
import type { PromptRepository } from '../../domain/ai/prompt.repository';

/**
 * Admin-only (enforced at the controller). Makes the prompt the single
 * active one for its feature type; idempotent for an already-active prompt.
 */
@Injectable()
export class ActivatePromptUseCase {
  constructor(
    @Inject(PROMPT_REPOSITORY)
    private readonly promptRepository: PromptRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: { actorId: string; promptId: string }): Promise<Prompt> {
    let prompt: Prompt | null;
    try {
      prompt = await this.promptRepository.activate(input.promptId);
    } catch (err) {
      if (err instanceof PromptActivationConflictError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
    if (!prompt) {
      throw new NotFoundException(`Prompt ${input.promptId} not found`);
    }
    const payload: PromptAuditEventPayload = {
      userId: input.actorId,
      promptId: prompt.id,
      featureType: prompt.featureType,
      version: prompt.version,
    };
    this.eventEmitter.emit(PROMPT_ACTIVATED_EVENT, payload);
    return prompt;
  }
}
