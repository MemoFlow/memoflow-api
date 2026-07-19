/**
 * Domain shape of one `ctx.gather.results` chunk
 * (`docs/contracts/context-result.schema.json`), after the infrastructure
 * consumer (`ContextResultsConsumer`) has parsed + structurally validated
 * the raw AMQP JSON body and mapped it to camelCase. Domain imports nothing
 * external — this is a plain-data mirror of the wire contract, not the wire
 * shape itself.
 */
export type ChunkPhase = 'started' | 'gathering' | 'completed' | 'failed';

/** `completed`/`failed` are terminal — no further chunks follow for this
 * `job_id` (`docs/contracts/context-engine.md` §3). Gated on `phase`, never
 * on `type`. */
export function isTerminalPhase(phase: ChunkPhase): boolean {
  return phase === 'completed' || phase === 'failed';
}

export interface ContextResultDataChunk {
  schemaVersion: 1;
  jobId: string;
  userId: string;
  sequence: number;
  type: 'data';
  data: {
    provider: string;
    content: string;
    tokenEstimate?: number;
  };
}

export interface ContextResultStatusChunk {
  schemaVersion: 1;
  jobId: string;
  userId: string;
  sequence: number;
  type: 'status';
  status: {
    phase: ChunkPhase;
    message?: string;
    errorCode?: string;
  };
}

export type ContextResultChunk =
  | ContextResultDataChunk
  | ContextResultStatusChunk;
