import { Inject, Injectable } from '@nestjs/common';
import { LLM_GATEWAY } from '../../domain/ai/llm-gateway.port';
import type { LlmGateway } from '../../domain/ai/llm-gateway.port';
import {
  LlmPlanner,
  PlanningResult,
} from '../../domain/context/llm-planner.port';

const SYSTEM_PROMPT =
  'You are a planning assistant. Reply only with a JSON object matching the provided schema.';

const PLANNING_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: { type: 'array', items: { type: 'string' } },
    outline: { type: ['string', 'null'] },
    sources: { type: 'array', items: { type: 'string' } },
  },
  required: ['suggestions', 'outline', 'sources'],
  additionalProperties: false,
} as const;

interface PlanningOutputShape {
  suggestions: string[];
  outline?: string | null;
  sources: string[];
}

/**
 * Real LLM-backed `LlmPlanner` on top of the `LlmGateway`. `ContextModule`
 * binds this when `OPENROUTER_API_KEY` is configured and `StubLlmPlanner`
 * otherwise. Any failure simply throws — `ProcessPlanningJobUseCase` catches
 * any `Error` from `plan` and records the job `failed`.
 */
@Injectable()
export class GatewayLlmPlanner implements LlmPlanner {
  constructor(@Inject(LLM_GATEWAY) private readonly gateway: LlmGateway) {}

  async plan(input: {
    prompt: string;
    context: Record<string, unknown>;
  }): Promise<PlanningResult> {
    if (!this.gateway.isAvailable()) {
      throw new Error(
        'LLM planner requested without OPENROUTER_API_KEY configured',
      );
    }

    const completion = await this.gateway.complete({
      system: SYSTEM_PROMPT,
      user: `${input.prompt}\n\nContext:\n${JSON.stringify(input.context)}`,
      jsonSchema: {
        name: 'planning_result',
        schema: PLANNING_OUTPUT_SCHEMA,
      },
    });

    return this.toPlanningResult(completion.json);
  }

  private toPlanningResult(parsed: unknown): PlanningResult {
    const shape = parsed as Partial<PlanningOutputShape> | null;
    if (
      typeof shape !== 'object' ||
      shape === null ||
      !Array.isArray(shape.suggestions) ||
      !Array.isArray(shape.sources)
    ) {
      throw new Error('LLM response JSON did not match the expected schema');
    }

    return {
      suggestions: shape.suggestions,
      outline: shape.outline ?? null,
      sources: shape.sources,
    };
  }
}
