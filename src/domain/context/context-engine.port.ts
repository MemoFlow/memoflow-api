/**
 * Port abstracting the external context engine — the service that turns a
 * user's connected connectors (+ their Composio MCP references) into the
 * context payload the LLM planner consumes. Implemented by
 * `ContextEngineHttpClient` (infrastructure only). Domain imports nothing
 * external.
 */
export const CONTEXT_ENGINE = Symbol('ContextEngine');

export interface GatherContextInput {
  userId: string;
  connectors: string[];
  prompt: string;
}

export interface ContextEnginePort {
  gatherContext(input: GatherContextInput): Promise<Record<string, unknown>>;
}
