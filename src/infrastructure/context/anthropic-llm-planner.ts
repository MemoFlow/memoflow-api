import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  LlmPlanner,
  PlanningResult,
} from '../../domain/context/llm-planner.port';
import { AnthropicClientProvider } from '../ai/anthropic.client';

const PLANNING_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: { type: 'array', items: { type: 'string' } },
    outline: { type: ['string', 'null'] },
    sources: { type: 'array', items: { type: 'string' } },
  },
  required: ['suggestions', 'sources'],
  additionalProperties: false,
} as const;

interface PlanningOutputShape {
  suggestions: string[];
  outline?: string | null;
  sources: string[];
}

/**
 * Real LLM-backed `LlmPlanner`. `ContextModule`'s `LLM_PLANNER` provider
 * factory binds this when `ANTHROPIC_API_KEY` is configured, and falls back
 * to `StubLlmPlanner` otherwise — mirroring how `CONTEXT_GATHERER` swaps on
 * `CONTEXT_ENGINE_URL`. The only class here allowed to import
 * `@anthropic-ai/sdk`; the domain port and `ContextModule` stay SDK-free.
 *
 * Any failure here (refusal, truncation, malformed JSON, SDK error) simply
 * throws — `ProcessPlanningJobUseCase` already catches any `Error` from
 * `LlmPlanner.plan` and records the job `failed`, so no typed-error mapping
 * is needed the way `AnthropicSuggestionGenerator` needs it for HTTP status
 * codes.
 */
@Injectable()
export class AnthropicLlmPlanner implements LlmPlanner {
  private readonly logger = new Logger(AnthropicLlmPlanner.name);

  constructor(private readonly clientProvider: AnthropicClientProvider) {}

  async plan(input: {
    prompt: string;
    context: Record<string, unknown>;
  }): Promise<PlanningResult> {
    if (!this.clientProvider.isAvailable()) {
      // ContextModule only binds this class when the API key is configured;
      // guarded again here so a misconfiguration fails loudly instead of a
      // confusing downstream error.
      throw new Error(
        'Anthropic planner requested without ANTHROPIC_API_KEY configured',
      );
    }

    const client = this.clientProvider.getClient();
    const renderedPrompt = this.renderPrompt(input.prompt, input.context);

    const message = await client.messages.create({
      model: this.clientProvider.getModel(),
      max_tokens: this.clientProvider.getMaxTokens(),
      messages: [{ role: 'user', content: renderedPrompt }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: PLANNING_OUTPUT_SCHEMA,
        },
      },
    });

    if (message.stop_reason === 'refusal') {
      throw new Error('The model refused to generate a plan');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new Error('The model response was truncated before completion');
    }

    const textBlock = message.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock) {
      throw new Error('Anthropic response contained no text content block');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (err) {
      this.logger.error(
        `Anthropic planning response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error('Anthropic response was not valid JSON');
    }

    return this.toPlanningResult(parsed);
  }

  private renderPrompt(
    prompt: string,
    context: Record<string, unknown>,
  ): string {
    return `${prompt}\n\nContext:\n${JSON.stringify(context)}`;
  }

  private toPlanningResult(parsed: unknown): PlanningResult {
    const shape = parsed as Partial<PlanningOutputShape> | null;
    if (
      typeof shape !== 'object' ||
      shape === null ||
      !Array.isArray(shape.suggestions) ||
      !Array.isArray(shape.sources)
    ) {
      throw new Error(
        'Anthropic response JSON did not match the expected schema',
      );
    }

    return {
      suggestions: shape.suggestions,
      outline: shape.outline ?? null,
      sources: shape.sources,
    };
  }
}
