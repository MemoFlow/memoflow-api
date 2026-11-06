import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PROMPT_CREATED_EVENT } from '../../domain/audit/audit-events';
import type { PromptAuditEventPayload } from '../../domain/audit/audit-events';
import {
  getPromptDefinition,
  PROMPT_FEATURE_TYPES,
  SYSTEM_TEMPLATE_PLACEHOLDERS,
} from '../../domain/ai/prompt-definitions';
import { listPlaceholders } from '../../domain/ai/prompt-render';
import { Prompt } from '../../domain/ai/prompt.entity';
import {
  PROMPT_REPOSITORY,
  PromptVersionConflictError,
} from '../../domain/ai/prompt.repository';
import type { PromptRepository } from '../../domain/ai/prompt.repository';

const PLACEHOLDER_PATTERN = /\{\{\s*\w+\s*\}\}/g;

export interface CreatePromptInput {
  actorId: string;
  featureType: string;
  version: string;
  systemTemplate: string;
  /** The user-message template. */
  userTemplate: string;
}

/**
 * Admin-only (enforced at the controller). Creates an INACTIVE prompt;
 * `userInvocable` comes from the feature type's definition, never the client.
 */
@Injectable()
export class CreatePromptUseCase {
  constructor(
    @Inject(PROMPT_REPOSITORY)
    private readonly promptRepository: PromptRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: CreatePromptInput): Promise<Prompt> {
    const definition = getPromptDefinition(input.featureType);
    if (!definition) {
      throw new BadRequestException(
        `Unknown feature type "${input.featureType}". Known types: ${PROMPT_FEATURE_TYPES.join(', ')}`,
      );
    }

    for (const [field, template, allowedList] of [
      ['system_template', input.systemTemplate, SYSTEM_TEMPLATE_PLACEHOLDERS],
      ['user_template', input.userTemplate, definition.allowedPlaceholders],
    ] as const) {
      const allowed = new Set(allowedList);
      const unknown = listPlaceholders(template).filter((n) => !allowed.has(n));
      if (unknown.length > 0) {
        throw new BadRequestException(
          `${field} uses placeholders not allowed for "${input.featureType}": ${unknown.join(', ')}. Allowed: ${allowedList.join(', ')}`,
        );
      }
      // Anything that still looks like a placeholder after the valid ones
      // are removed would reach the model as literal text.
      if (/\{\{|\}\}/.test(template.replace(PLACEHOLDER_PATTERN, ''))) {
        throw new BadRequestException(
          `${field} contains a malformed placeholder ("{{" or "}}" outside a valid {{name}})`,
        );
      }
    }
    if (
      !listPlaceholders(input.userTemplate).includes(
        definition.requiredUserPlaceholder,
      )
    ) {
      throw new BadRequestException(
        `user_template must contain {{${definition.requiredUserPlaceholder}}}`,
      );
    }

    let prompt: Prompt;
    try {
      prompt = await this.promptRepository.create({
        featureType: input.featureType,
        version: input.version,
        systemTemplate: input.systemTemplate,
        template: input.userTemplate,
        userInvocable: definition.userInvocable,
      });
    } catch (err) {
      if (err instanceof PromptVersionConflictError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }

    const payload: PromptAuditEventPayload = {
      userId: input.actorId,
      promptId: prompt.id,
      featureType: prompt.featureType,
      version: prompt.version,
    };
    this.eventEmitter.emit(PROMPT_CREATED_EVENT, payload);
    return prompt;
  }
}
