import { Injectable } from '@nestjs/common';
import {
  LlmPlanner,
  PlanningResult,
} from '../../domain/context/llm-planner.port';

/**
 * Stub implementation — the real LLM integration is roadmap item 5. Echoes
 * the prompt back as a single suggestion so the async pipeline (queue ->
 * worker -> persisted result) is exercisable end to end today.
 */
@Injectable()
export class StubLlmPlanner implements LlmPlanner {
  plan(input: {
    prompt: string;
    context: Record<string, unknown>;
  }): Promise<PlanningResult> {
    return Promise.resolve({
      suggestions: [`(stub plan) ${input.prompt}`],
      outline: null,
      sources: [],
    });
  }
}
