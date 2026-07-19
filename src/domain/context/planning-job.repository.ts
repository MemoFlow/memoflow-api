import { JobStatus, PlanningJob } from './planning-job';

export const PLANNING_JOB_REPOSITORY = Symbol('PlanningJobRepository');

export interface CreatePlanningJobData {
  userId: string;
  prompt: string;
  connectors: string[];
  documentId?: string | null;
  sectionId?: string | null;
}

/**
 * Fields a later (process-planning-job) use-case is allowed to update once a
 * job has been created. `status` is always set; the rest are optional so a
 * single call can move a job through `running` -> `completed`/`failed`.
 */
export interface UpdatePlanningJobStatusData {
  status: JobStatus;
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  /** Version of the active 'planning' prompt used, recorded by the worker. */
  promptVersion?: string | null;
  /** Context-gatherer result used for this run, recorded by the worker. */
  contextUsed?: Record<string, unknown> | null;
}

/** Input to `PlanningJobRepository.appendResultChunk` — the atomic,
 * idempotent-by-`(job_id, sequence)` append of one `ctx.gather.results`
 * chunk (see `docs/contracts/context-engine.md` §3). */
export interface AppendResultChunkData {
  sequence: number;
  type: 'data' | 'status';
  /** Present (and persisted) only when `type === 'data'`. */
  data?: {
    provider: string;
    content: string;
    tokenEstimate?: number | null;
  };
}

export interface AppendResultChunkOutcome {
  /**
   * `false` when `(job_id, sequence)` was already recorded — a duplicate
   * delivery the caller must treat as a no-op (ack, don't reprocess).
   */
  applied: boolean;
  /**
   * The job's current state after this call. `null` only when the job
   * itself doesn't exist (unknown `job_id` — the caller nacks
   * no-requeue). Non-null (with `applied: false`) on a duplicate sequence,
   * so the caller can still read the job's current status/accumulated
   * chunks.
   */
  job: PlanningJob | null;
}

export interface PlanningJobRepository {
  create(data: CreatePlanningJobData): Promise<PlanningJob>;
  findById(id: string): Promise<PlanningJob | null>;
  updateStatus(
    id: string,
    patch: UpdatePlanningJobStatusData,
  ): Promise<PlanningJob | null>;
  /**
   * Atomically transitions a job from `pending` to `running`, returning the
   * updated job only if the claim succeeded. Returns `null` if the job is
   * missing, already `running` (claimed by another worker), or already
   * terminal (`completed`/`failed`) — the caller treats all of those as
   * "nothing to do" rather than distinguishing them, since a stalled-job
   * retry and a concurrent worker must both be safe no-ops.
   *
   * Legacy synchronous HTTP/stub path only (`RABBITMQ_URL` unset) — see
   * `claimForGathering` for the queue-transport path.
   */
  claimForProcessing(id: string): Promise<PlanningJob | null>;
  /**
   * Atomically transitions a job from `pending` to `gathering` — the
   * RabbitMQ-transport equivalent of `claimForProcessing`, claimed just
   * before the gather request is published to `ctx.gather.requests`. Same
   * "missing / already claimed / already terminal -> null, safe no-op"
   * contract.
   */
  claimForGathering(id: string): Promise<PlanningJob | null>;
  /**
   * Atomically appends one `ctx.gather.results` chunk, guarded by
   * `(job_id, sequence)` so a redelivered/duplicate chunk is a no-op
   * (`applied: false`) rather than double-processed. `data` chunks are
   * accumulated onto the job's `dataChunks` so a later terminal `completed`
   * chunk can assemble the full context without replaying the stream.
   * Does NOT itself change `status` — callers decide status transitions
   * (`gathering -> planning -> completed/failed`) via `updateStatus`.
   */
  appendResultChunk(
    id: string,
    chunk: AppendResultChunkData,
  ): Promise<AppendResultChunkOutcome>;
  /**
   * Atomically transitions `gathering -> planning`, recording the assembled
   * context, returning `null` (a safe no-op for the caller) if the job is
   * NOT currently `gathering` — already claimed by a concurrent/duplicate
   * terminal `completed` chunk, already failed (by `failIfStillGathering`
   * or a duplicate terminal `failed` chunk), or missing. This CAS is what
   * makes `HandleContextResultChunkUseCase`'s finalization race-safe: two
   * distinct-sequence terminal chunks (a CE bug) or a terminal chunk racing
   * the no-result timeout can only ever have one winner enter `planning`.
   */
  claimForPlanning(
    id: string,
    contextUsed: Record<string, unknown>,
  ): Promise<PlanningJob | null>;
  /**
   * Atomically transitions `gathering -> failed`, returning `null` (a safe
   * no-op for the caller) if the job is NOT currently `gathering` — the
   * same CAS guard as `claimForPlanning`, covering the failure side: used
   * by both `HandleGatherTimeoutUseCase` (no-result timeout) and
   * `HandleContextResultChunkUseCase` (terminal `failed` chunk), so a
   * timeout racing a real terminal chunk (either phase), or two
   * distinct-sequence terminal chunks, can only ever have one winner.
   */
  failIfStillGathering(
    id: string,
    patch: { errorCode: string; errorMessage: string },
  ): Promise<PlanningJob | null>;
}
