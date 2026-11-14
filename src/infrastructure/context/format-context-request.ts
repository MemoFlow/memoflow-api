import type { GatherInput } from '../../domain/context/context-gatherer.port';

/**
 * Normalizes a gather request before it reaches the context-engine port:
 * collapses stray whitespace in the prompt and dedupes requested connector
 * ids (order-preserving) so every `ContextEnginePort` implementation sees a
 * clean payload rather than each one re-implementing this.
 */
export function formatContextRequest(input: GatherInput): GatherInput {
  return {
    ...input,
    prompt: input.prompt.trim().replace(/\s+/g, ' '),
    connectors: dedupe(input.connectors),
  };
}

function dedupe(connectors: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const connector of connectors) {
    if (seen.has(connector)) continue;
    seen.add(connector);
    result.push(connector);
  }
  return result;
}
