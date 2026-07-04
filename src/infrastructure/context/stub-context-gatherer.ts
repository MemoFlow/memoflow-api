import { Injectable } from '@nestjs/common';
import { ContextGatherer } from '../../domain/context/context-gatherer.port';

/**
 * Stub implementation — real connectors are roadmap item 7. Returns a
 * deterministic placeholder so the processing pipeline has something to
 * hand the (also stubbed) LLM planner.
 */
@Injectable()
export class StubContextGatherer implements ContextGatherer {
  gather(connectors: string[]): Promise<Record<string, unknown>> {
    return Promise.resolve({
      requestedConnectors: connectors,
      note: 'stub — no real connectors until roadmap item 7',
    });
  }
}
