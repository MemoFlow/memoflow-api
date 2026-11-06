import { Injectable } from '@nestjs/common';
import {
  ContextGatherer,
  GatherInput,
  STUB_CONTEXT_NOTE,
} from '../../domain/context/context-gatherer.port';

/**
 * No-op fallback used when no external context engine is configured
 * (`CONTEXT_ENGINE_URL` unset — see `ContextModule`'s `CONTEXT_GATHERER`
 * factory). Returns a deterministic placeholder so the processing pipeline
 * has something to hand the (also stubbed) LLM planner.
 */
@Injectable()
export class StubContextGatherer implements ContextGatherer {
  gather(input: GatherInput): Promise<Record<string, unknown>> {
    return Promise.resolve({
      requestedConnectors: input.connectors,
      note: STUB_CONTEXT_NOTE,
    });
  }
}
