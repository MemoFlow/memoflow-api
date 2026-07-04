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
}

export interface PlanningJobRepository {
  create(data: CreatePlanningJobData): Promise<PlanningJob>;
  findById(id: string): Promise<PlanningJob | null>;
  updateStatus(
    id: string,
    patch: UpdatePlanningJobStatusData,
  ): Promise<PlanningJob | null>;
}
