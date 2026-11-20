/**
 * Port for the delayed re-run of a planning job's planning phase after the
 * AI provider rate-limited it. Implemented by a BullMQ delayed job
 * (`BullMqPlanningRetryScheduler`, infrastructure only), so waiting never
 * blocks a consumer or a worker and survives a restart.
 */
export const PLANNING_RETRY_SCHEDULER = Symbol('PlanningRetryScheduler');

export interface SchedulePlanningRetryInput {
  jobId: string;
  /** 1-based number of this retry (1 = first retry). */
  attempt: number;
  /** Milliseconds from now the retry should run. */
  delayMs: number;
}

export interface PlanningRetryScheduler {
  /**
   * Enqueues the retry. Idempotent per `(jobId, attempt)`: scheduling the
   * same attempt twice keeps a single delayed job.
   */
  scheduleRetry(input: SchedulePlanningRetryInput): Promise<void>;
}
