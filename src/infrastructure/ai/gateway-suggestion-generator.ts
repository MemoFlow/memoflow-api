import { Inject, Injectable } from '@nestjs/common';
import { LLM_GATEWAY } from '../../domain/ai/llm-gateway.port';
import type { LlmGateway } from '../../domain/ai/llm-gateway.port';
import { SuggestionGenerationProviderError } from '../../domain/ai/suggestion-generation.errors';
import {
  GenerateSuggestionInput,
  GenerateSuggestionOutput,
  SuggestionGenerator,
} from '../../domain/ai/suggestion-generator.port';

const SYSTEM_PROMPT =
  'You are a writing assistant. Reply only with a JSON object matching the provided schema.';

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
 * propagate unchanged.
 */
@Injectable()
export class GatewaySuggestionGenerator implements SuggestionGenerator {
  constructor(@Inject(LLM_GATEWAY) private readonly gateway: LlmGateway) {}

  isAvailable(): boolean {
    return this.gateway.isAvailable();
  }

  async generate(
    input: GenerateSuggestionInput,
  ): Promise<GenerateSuggestionOutput> {
    const completion = await this.gateway.complete({
      system: SYSTEM_PROMPT,
      user: input.promptTemplate,
      jsonSchema: {
        name: 'suggestion',
        schema: SUGGESTION_OUTPUT_SCHEMA,
      },
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
    return { suggestedText: json.suggested_text };
  }
}
