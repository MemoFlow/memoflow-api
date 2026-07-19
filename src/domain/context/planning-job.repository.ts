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
   */
  claimForProcessing(id: string): Promise<PlanningJob | null>;
}
