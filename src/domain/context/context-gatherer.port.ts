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

/**
 * The exact `note` `StubContextGatherer` returns. The planning pipeline
 * recognises the stub's placeholder by comparing for equality, so a real
 * gatherer's own `note` is never mistaken for it.
 */
export const STUB_CONTEXT_NOTE =
  'stub — no context engine configured (CONTEXT_ENGINE_URL unset)';
