import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  SuggestionGenerationProviderError,
  SuggestionGenerationRefusedError,
  SuggestionGenerationTruncatedError,
  SuggestionGeneratorRateLimitedError,
  SuggestionGeneratorUnavailableError,
} from '../../domain/ai/suggestion-generation.errors';
import {
  GenerateSuggestionInput,
  GenerateSuggestionOutput,
  SuggestionGenerator,
} from '../../domain/ai/suggestion-generator.port';
import { AnthropicClientProvider } from './anthropic.client';

const SUGGESTION_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    suggested_text: { type: 'string' },
  },
  required: ['suggested_text'],
  additionalProperties: false,
} as const;

interface SuggestionOutputShape {
  suggested_text: string;
}

/**
 * `SuggestionGenerator` implementation backed by the real Anthropic API.
 * The ONLY class in this file allowed to import `@anthropic-ai/sdk` —
 * enforced by the "infrastructure is the only layer importing SDKs" rule.
 * Bound only when `ANTHROPIC_API_KEY` is set (see `ai.module.ts`); the
 * `NullSuggestionGenerator` covers the unset case.
 */
@Injectable()
export class AnthropicSuggestionGenerator implements SuggestionGenerator {
  private readonly logger = new Logger(AnthropicSuggestionGenerator.name);

  constructor(private readonly clientProvider: AnthropicClientProvider) {}

  isAvailable(): boolean {
    return this.clientProvider.isAvailable();
  }

  async generate(
    input: GenerateSuggestionInput,
  ): Promise<GenerateSuggestionOutput> {
    if (!this.clientProvider.isAvailable()) {
      throw new SuggestionGeneratorUnavailableError();
    }

    const client = this.clientProvider.getClient();

    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: this.clientProvider.getModel(),
        max_tokens: this.clientProvider.getMaxTokens(),
        messages: [{ role: 'user', content: input.promptTemplate }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: SUGGESTION_OUTPUT_SCHEMA,
          },
        },
      });
    } catch (err) {
      throw this.mapSdkError(err);
    }

    if (message.stop_reason === 'refusal') {
      throw new SuggestionGenerationRefusedError();
    }
    if (message.stop_reason === 'max_tokens') {
      throw new SuggestionGenerationTruncatedError();
    }

    const textBlock = message.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock) {
      throw new SuggestionGenerationProviderError(
        'Anthropic response contained no text content block',
      );
    }

    const parsed = this.parseOutput(textBlock.text);
    return { suggestedText: parsed.suggested_text };
  }

  private parseOutput(text: string): SuggestionOutputShape {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SuggestionGenerationProviderError(
        'Anthropic response was not valid JSON',
      );
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Partial<SuggestionOutputShape>).suggested_text !==
        'string'
    ) {
      throw new SuggestionGenerationProviderError(
        'Anthropic response JSON did not match the expected schema',
      );
    }

    return parsed as SuggestionOutputShape;
  }

  private mapSdkError(err: unknown): Error {
    if (err instanceof Anthropic.RateLimitError) {
      const retryAfterHeader = err.headers?.get('retry-after');
      const retryAfterSeconds = retryAfterHeader
        ? Number(retryAfterHeader)
        : undefined;
      return new SuggestionGeneratorRateLimitedError(
        'Anthropic rate limit exceeded',
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
      );
    }
    if (err instanceof Anthropic.APIError) {
      this.logger.error(`Anthropic API error: ${err.message}`);
      return new SuggestionGenerationProviderError(err.message);
    }
    const message =
      err instanceof Error ? err.message : 'Unexpected Anthropic client error';
    this.logger.error(`Unexpected error calling Anthropic: ${message}`);
    return new SuggestionGenerationProviderError(message);
  }
}
