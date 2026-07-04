/**
 * Port abstracting the LLM planning call. The real LLM integration lands
 * with roadmap item 5 (AI layer) — this branch only wires the shape behind
 * an echo stub. Domain imports nothing external.
 */
export const LLM_PLANNER = Symbol('LlmPlanner');

export interface PlanningResult {
  suggestions: string[];
  outline?: unknown;
  sources: unknown[];
}

export interface LlmPlanner {
  plan(input: {
    prompt: string;
    context: Record<string, unknown>;
  }): Promise<PlanningResult>;
}
