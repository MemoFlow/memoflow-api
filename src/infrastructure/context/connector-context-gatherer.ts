import { Inject, Injectable } from '@nestjs/common';
import { ContextGatherer } from '../../domain/context/context-gatherer.port';
import type { GatherInput } from '../../domain/context/context-gatherer.port';
import { CONTEXT_ENGINE } from '../../domain/context/context-engine.port';
import type { ContextEnginePort } from '../../domain/context/context-engine.port';
import { formatContextRequest } from './format-context-request';

/**
 * Real `ContextGatherer` — formats the request (see `formatContextRequest`)
 * then delegates to the external context engine via `ContextEnginePort`.
 * Selected by `ContextModule`'s `CONTEXT_GATHERER` factory when
 * `CONTEXT_ENGINE_URL` is configured; falls back to `StubContextGatherer`
 * otherwise.
 */
@Injectable()
export class ConnectorContextGatherer implements ContextGatherer {
  constructor(
    @Inject(CONTEXT_ENGINE)
    private readonly contextEngine: ContextEnginePort,
  ) {}

  gather(input: GatherInput): Promise<Record<string, unknown>> {
    return this.contextEngine.gatherContext(formatContextRequest(input));
  }
}
