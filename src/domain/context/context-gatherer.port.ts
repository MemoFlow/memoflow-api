/**
 * Port abstracting connector context assembly. Roadmap item 7 (branch 3)
 * wires this to the real connectors + external context engine
 * (`ConnectorContextGatherer` / `ContextEnginePort`); `StubContextGatherer`
 * remains available as the no-op fallback when no context engine is
 * configured. Domain imports nothing external.
 */
export const CONTEXT_GATHERER = Symbol('ContextGatherer');

export interface GatherInput {
  userId: string;
  connectors: string[];
  prompt: string;
}

export interface ContextGatherer {
  gather(input: GatherInput): Promise<Record<string, unknown>>;
}
