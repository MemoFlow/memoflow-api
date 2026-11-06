/**
 * Port abstracting the LLM planning call. Domain imports nothing external.
 */
export const LLM_PLANNER = Symbol('LlmPlanner');

export interface PlanningResult {
  suggestions: string[];
  outline?: unknown;
  sources: unknown[];
  /** Model that served the call; null when the planner has none (stub). */
  model: string | null;
}

export interface PlanInput {
  /** The job owner; provider attempts count against their quota. */
  userId: string;
  /** Raw request and gathered context (used by the stub planner). */
  prompt: string;
  context: Record<string, unknown>;
  /** Fully rendered system message (used by the gateway planner). */
  system: string;
  /** Fully rendered user message (used by the gateway planner). */
  user: string;
}

export interface LlmPlanner {
  plan(input: PlanInput): Promise<PlanningResult>;
}
