import { Inject, Injectable } from '@nestjs/common';
import { Prompt } from '../../domain/ai/prompt.entity';
import { PROMPT_REPOSITORY } from '../../domain/ai/prompt.repository';
import type { PromptRepository } from '../../domain/ai/prompt.repository';

/** Admin-only (enforced at the controller). */
@Injectable()
export class ListPromptsUseCase {
  constructor(
    @Inject(PROMPT_REPOSITORY)
    private readonly promptRepository: PromptRepository,
  ) {}

  execute(input: { featureType?: string }): Promise<Prompt[]> {
    return this.promptRepository.list(input.featureType);
  }
}
