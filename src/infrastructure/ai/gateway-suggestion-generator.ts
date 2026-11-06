import { Inject, Injectable } from '@nestjs/common';
import { AI_QUOTA } from '../../domain/ai/ai-quota.port';
import type { AiQuota } from '../../domain/ai/ai-quota.port';
import { LLM_GATEWAY } from '../../domain/ai/llm-gateway.port';
import type { LlmGateway } from '../../domain/ai/llm-gateway.port';
import { SuggestionGenerationProviderError } from '../../domain/ai/suggestion-generation.errors';
import {
  GenerateSuggestionInput,
  GenerateSuggestionOutput,
  SuggestionGenerator,
} from '../../domain/ai/suggestion-generator.port';

const SUGGESTION_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    suggested_text: { type: 'string' },
  },
  required: ['suggested_text'],
  additionalProperties: false,
} as const;

/**
 * `SuggestionGenerator` backed by the `LlmGateway`. Bound only when
 * `OPENROUTER_API_KEY` is set (see `ai.module.ts`); `NullSuggestionGenerator`
 * covers the unset case. Gateway failures are already typed domain errors and
 * propagate unchanged. Every provider attempt first reserves one unit of the
 * user's daily quota.
 */
@Injectable()
export class GatewaySuggestionGenerator implements SuggestionGenerator {
  constructor(
    @Inject(LLM_GATEWAY) private readonly gateway: LlmGateway,
    @Inject(AI_QUOTA) private readonly quota: AiQuota,
  ) {}

  isAvailable(): boolean {
    return this.gateway.isAvailable();
  }

  cacheScope(): string {
    return this.gateway.modelIdentity();
  }

  async generate(
    input: GenerateSuggestionInput,
  ): Promise<GenerateSuggestionOutput> {
    const completion = await this.gateway.complete({
      system: input.system,
      user: input.user,
      jsonSchema: {
        name: 'suggestion',
        schema: SUGGESTION_OUTPUT_SCHEMA,
      },
      // One unit per provider attempt, retries included. A quota error
      // propagates out of the gateway unchanged and stops the retrying.
      beforeAttempt: () => this.quota.reserve(input.userId),
    });

    const json = completion.json as { suggested_text?: unknown } | null;
    if (
      typeof json !== 'object' ||
      json === null ||
      typeof json.suggested_text !== 'string'
    ) {
      throw new SuggestionGenerationProviderError(
        'The AI provider returned a response that did not match the expected schema',
      );
    }
    return { suggestedText: json.suggested_text, model: completion.model };
  }
}
