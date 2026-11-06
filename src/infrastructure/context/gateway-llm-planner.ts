import { Inject, Injectable } from '@nestjs/common';
import { AI_QUOTA } from '../../domain/ai/ai-quota.port';
import type { AiQuota } from '../../domain/ai/ai-quota.port';
import { LLM_GATEWAY } from '../../domain/ai/llm-gateway.port';
import type { LlmGateway } from '../../domain/ai/llm-gateway.port';
import { PlanningOutputInvalidError } from '../../domain/context/planning-errors';
import {
  LlmPlanner,
  PlanInput,
  PlanningResult,
} from '../../domain/context/llm-planner.port';

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

const MAX_LIST_ITEMS = 50;
const MAX_ITEM_CHARS = 5000;
const MAX_OUTLINE_CHARS = 100_000;

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
  constructor(
    @Inject(LLM_GATEWAY) private readonly gateway: LlmGateway,
    @Inject(AI_QUOTA) private readonly quota: AiQuota,
  ) {}

  async plan(input: PlanInput): Promise<PlanningResult> {
    if (!this.gateway.isAvailable()) {
      throw new Error(
        'LLM planner requested without OPENROUTER_API_KEY configured',
      );
    }

    const completion = await this.gateway.complete({
      system: input.system,
      user: input.user,
      jsonSchema: {
        name: 'planning_result',
        schema: PLANNING_OUTPUT_SCHEMA,
      },
      // One unit per provider attempt, retries included. A quota error
      // propagates out of the gateway unchanged; the job records it.
      beforeAttempt: () => this.quota.reserve(input.userId),
    });

    return this.toPlanningResult(completion.json, completion.model);
  }

  private toPlanningResult(parsed: unknown, model: string): PlanningResult {
    const shape = parsed as Partial<PlanningOutputShape> | null;
    if (
      typeof shape !== 'object' ||
      shape === null ||
      !isStringList(shape.suggestions, MAX_LIST_ITEMS) ||
      !isStringList(shape.sources, MAX_LIST_ITEMS)
    ) {
      throw new PlanningOutputInvalidError();
    }
    const outline = shape.outline ?? null;
    if (
      outline !== null &&
      (typeof outline !== 'string' || outline.length > MAX_OUTLINE_CHARS)
    ) {
      throw new PlanningOutputInvalidError();
    }

    return {
      suggestions: shape.suggestions,
      outline,
      sources: shape.sources,
      model,
    };
  }
}

/** Array of non-empty strings, bounded in count and per-item length. */
function isStringList(value: unknown, maxItems: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every(
      (item) =>
        typeof item === 'string' &&
        item.trim() !== '' &&
        item.length <= MAX_ITEM_CHARS,
    )
  );
}
