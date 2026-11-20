import { SuggestionGeneratorRateLimitedError } from '../../domain/ai/suggestion-generation.errors';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import type { PlanningJobRepository } from '../../domain/context/planning-job.repository';
import type { PlanningRetryScheduler } from '../../domain/context/planning-retry-scheduler.port';

/** DI token for the `PlanningRetryPolicy` (plain config, not a port). */
export const PLANNING_RETRY_POLICY = Symbol('PlanningRetryPolicy');

export interface PlanningRetryPolicy {
  /** Minimum delay before retry 1, 2, ... The length is the retry count. */
  baseDelaysMs: readonly number[];
  /** Cap on a delay driven by the provider's Retry-After. */
  maxDelayMs: number;
}

export const DEFAULT_PLANNING_RETRY_POLICY: PlanningRetryPolicy = {
  baseDelaysMs: [30_000, 120_000],
  maxDelayMs: 600_000,
};

/** Shown to the owner while a retry is pending. */
export const PLANNING_RETRY_MESSAGE = 'AI provider busy, retrying';

/** Dependencies of a retry decision; absent = rate limits fail the job. */
export interface PlanningRetryDeps {
  scheduler: PlanningRetryScheduler;
  policy: PlanningRetryPolicy;
}

/**
 * Delay before retry number `attempt` (1-based): the policy's base delay,
 * or the provider's Retry-After when that is longer, capped at `maxDelayMs`.
 */
export function planningRetryDelayMs(
  policy: PlanningRetryPolicy,
  attempt: number,
  retryAfterSeconds?: number,
): number {
  const base = policy.baseDelaysMs[attempt - 1] ?? 0;
  const hinted =
    retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)
      ? Math.min(Math.max(0, retryAfterSeconds) * 1000, policy.maxDelayMs)
      : 0;
  return Math.max(base, hinted);
}

export interface RetryScheduleInput {
  repository: PlanningJobRepository;
  retry: PlanningRetryDeps | undefined;
  job: PlanningJob;
  err: unknown;
  /** Connector context (plus retrieval metadata) to re-plan with. */
  contextUsed: Record<string, unknown>;
  promptVersion: string | null;
}

/** Outcome of `scheduleRateLimitRetry`. */
export type RetryScheduleOutcome =
  /** Retry persisted and enqueued; the job is waiting (non-terminal). */
  | { kind: 'scheduled'; job: PlanningJob }
  /** Nothing was scheduled (other error, retries exhausted, no scheduler,
   * persist/enqueue failure): the caller fails the job. */
  | { kind: 'not_eligible' }
  /** The CAS lost: the job went terminal or its retry count moved. The
   * caller must not write anything; `job` is its current state. */
  | { kind: 'lost_race'; job: PlanningJob };

/**
 * If `err` is a provider rate limit and retries remain, records the retry
 * on the job (it stays in its non-terminal status) and enqueues the delayed
 * run. Never throws.
 */
export async function scheduleRateLimitRetry(
  input: RetryScheduleInput,
): Promise<RetryScheduleOutcome> {
  const { retry, job, err } = input;
  if (!retry || !(err instanceof SuggestionGeneratorRateLimitedError)) {
    return { kind: 'not_eligible' };
  }
  if (job.status !== JobStatus.Planning && job.status !== JobStatus.Running) {
    return { kind: 'not_eligible' };
  }
  const attempt = job.planningRetryCount + 1;
  if (attempt > retry.policy.baseDelaysMs.length) {
    return { kind: 'not_eligible' };
  }

  const delayMs = planningRetryDelayMs(
    retry.policy,
    attempt,
    err.retryAfterSeconds,
  );
  let updated: PlanningJob | null;
  try {
    updated = await input.repository.scheduleRetry(job.id, {
      expectedRetryCount: job.planningRetryCount,
      nextRetryAt: new Date(Date.now() + delayMs),
      contextUsed: input.contextUsed,
      promptVersion: input.promptVersion,
    });
  } catch {
    return { kind: 'not_eligible' };
  }
  if (!updated) {
    let current: PlanningJob | null = null;
    try {
      current = await input.repository.findById(job.id);
    } catch {
      // Fall back to the caller's copy below.
    }
    return { kind: 'lost_race', job: current ?? job };
  }
  try {
    await retry.scheduler.scheduleRetry({ jobId: job.id, attempt, delayMs });
    return { kind: 'scheduled', job: updated };
  } catch {
    // Could not enqueue: best-effort rollback of the pending retry (the CAS
    // clears `next_retry_at` only while it is still pending), then let the
    // caller fail the job rather than leave it waiting on nothing.
    try {
      await input.repository.claimPlanningRetry(job.id, attempt);
    } catch {
      // Terminal writes clear `next_retry_at` anyway.
    }
    return { kind: 'not_eligible' };
  }
}

/** Seconds until the pending retry, for the client message. */
export function retryDelaySeconds(job: PlanningJob): number {
  return job.nextRetryAt
    ? Math.max(0, Math.ceil((job.nextRetryAt.getTime() - Date.now()) / 1000))
    : 0;
}

/** Connector context of a job, as stored: `context_used` minus the
 * `retrieval` metadata that planning adds (retrieval is recomputed). */
export function connectorContextOf(job: PlanningJob): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(job.contextUsed ?? {}).filter(([k]) => k !== 'retrieval'),
  );
}

/** Payload of the `planning.status` event announcing a pending retry. */
export interface PlanningRetryStatusEvent {
  jobId: string;
  userId: string;
  status: JobStatus.Running | JobStatus.Planning;
  message: string;
  retryAt: string;
  retryInSeconds: number;
  retryCount: number;
}

/** The retry status fields a client sees (no routing `userId`). */
export function retryStatusFields(
  job: PlanningJob,
): Omit<PlanningRetryStatusEvent, 'jobId' | 'userId'> {
  const seconds = retryDelaySeconds(job);
  return {
    status:
      job.status === JobStatus.Running ? JobStatus.Running : JobStatus.Planning,
    message: `${PLANNING_RETRY_MESSAGE} in ${seconds} s`,
    retryAt: (job.nextRetryAt ?? new Date()).toISOString(),
    retryInSeconds: seconds,
    retryCount: job.planningRetryCount,
  };
}

export function retryStatusEvent(job: PlanningJob): PlanningRetryStatusEvent {
  return { jobId: job.id, userId: job.userId, ...retryStatusFields(job) };
}

/** True when `job` is in flight and waiting on a scheduled retry. */
export function isAwaitingRetry(job: PlanningJob): boolean {
  return (
    job.nextRetryAt !== null &&
    (job.status === JobStatus.Planning || job.status === JobStatus.Running)
  );
}
