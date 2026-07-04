/**
 * Port abstracting connector context assembly. Real connectors + OAuth vault
 * land with roadmap item 7 — this branch only wires the shape so the
 * processing use-case has something to call. Domain imports nothing
 * external.
 */
export const CONTEXT_GATHERER = Symbol('ContextGatherer');

export interface ContextGatherer {
  gather(
    connectors: string[],
    prompt: string,
  ): Promise<Record<string, unknown>>;
}
