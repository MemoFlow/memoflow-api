/**
 * Port abstracting the durable "no-result timeout" for a planning job's
 * context-gather step (`docs/contracts/context-engine.md` §4: if no
 * terminal chunk arrives within a configured window, fail the job with
 * `error_code: CONTEXT_ENGINE_TIMEOUT`). Implemented by a BullMQ delayed job
 * (`BullMqGatherTimeoutScheduler`, infrastructure only) rather than a bare
 * `setTimeout`, so the timeout survives a process restart. Only provided by
 * `ContextModule` when `RABBITMQ_URL` is configured — the legacy
 * synchronous HTTP/stub path has no async gather step to time out.
 */
export const GATHER_TIMEOUT_SCHEDULER = Symbol('GatherTimeoutScheduler');

export interface ScheduleGatherTimeoutInput {
  jobId: string;
  /** Milliseconds from now the timeout should fire — `CONTEXT_GATHER_TIMEOUT_MS`. */
  delayMs: number;
}

export interface GatherTimeoutScheduler {
  scheduleTimeout(input: ScheduleGatherTimeoutInput): Promise<void>;
}
