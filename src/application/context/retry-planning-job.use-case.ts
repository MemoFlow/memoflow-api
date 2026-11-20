import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PROMPT_REPOSITORY } from '../../domain/ai/prompt.repository';
import type { PromptRepository } from '../../domain/ai/prompt.repository';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import { PLANNING_FAILED_MESSAGE } from '../../domain/context/planning-errors';
import { errorName } from './planning-prompt';
import { PLANNING_JOB_REPOSITORY } from '../../domain/context/planning-job.repository';
import type { PlanningJobRepository } from '../../domain/context/planning-job.repository';
import { PLANNING_RETRY_SCHEDULER } from '../../domain/context/planning-retry-scheduler.port';
import type { PlanningRetryScheduler } from '../../domain/context/planning-retry-scheduler.port';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';
import { PlanningPipeline } from './planning-pipeline';
import {
  connectorContextOf,
  DEFAULT_PLANNING_RETRY_POLICY,
  PLANNING_RETRY_POLICY,
} from './planning-retry';
import type { PlanningRetryPolicy } from './planning-retry';
import { runClaimedPlanning } from './run-claimed-planning';

export interface RetryPlanningJobInput {
  jobId: string;
  /** Retry number being run (1 = first), matching the job's count. */
  attempt: number;
}

export interface RetryPlanningJobResult {
  /** False when nothing was claimed: the job went terminal, was already
   * retried (duplicate delivery) or is gone. */
  processed: boolean;
  job: PlanningJob | null;
}

/**
 * Re-runs the planning phase of a job a provider rate limit parked. No new
 * gather: it re-plans with the connector context already stored on the job.
 * The claim is a CAS on the in-flight status, the retry count and a pending
 * `nextRetryAt`, so a duplicate delivery or a job that went terminal meanwhile
 * is a no-op. The shared planning phase re-checks the user, AI consent and
 * quota, and may schedule the next retry or end the job.
 */
@Injectable()
export class RetryPlanningJobUseCase {
  private readonly logger = new Logger(RetryPlanningJobUseCase.name);

  constructor(
    @Inject(PLANNING_JOB_REPOSITORY)
    private readonly planningJobRepository: PlanningJobRepository,
    private readonly planningPipeline: PlanningPipeline,
    @Inject(PROMPT_REPOSITORY)
    private readonly promptRepository: PromptRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    @Optional()
    @Inject(PLANNING_RETRY_SCHEDULER)
    private readonly scheduler?: PlanningRetryScheduler,
    @Optional()
    @Inject(PLANNING_RETRY_POLICY)
    private readonly policy: PlanningRetryPolicy = DEFAULT_PLANNING_RETRY_POLICY,
  ) {}

  async execute(input: RetryPlanningJobInput): Promise<RetryPlanningJobResult> {
    const claimed = await this.planningJobRepository.claimPlanningRetry(
      input.jobId,
      input.attempt,
    );
    if (!claimed) return { processed: false, job: null };

    let job: PlanningJob;
    try {
      job = await this.run(claimed);
    } catch (err) {
      // The claim cleared `next_retry_at`, so a redelivery would be a no-op:
      // end the job instead of leaving it in flight forever.
      this.logger.error(
        `Planning job ${claimed.id} retry failed unexpectedly (${errorName(err)})`,
      );
      const patch = {
        status: JobStatus.Failed,
        errorCode: 'PROCESSING_FAILED',
        errorMessage: PLANNING_FAILED_MESSAGE,
        finishedAt: new Date(),
      };
      try {
        job = (await this.planningJobRepository.updateStatus(
          claimed.id,
          patch,
        )) ?? { ...claimed, ...patch };
      } catch {
        job = { ...claimed, ...patch };
      }
    }
    return { processed: true, job };
  }

  private run(claimed: PlanningJob): Promise<PlanningJob> {
    return runClaimedPlanning(
      {
        planningJobRepository: this.planningJobRepository,
        planningPipeline: this.planningPipeline,
        promptRepository: this.promptRepository,
        userRepository: this.userRepository,
        logger: this.logger,
        retry: this.scheduler
          ? { scheduler: this.scheduler, policy: this.policy }
          : undefined,
      },
      claimed,
      connectorContextOf(claimed),
    );
  }
}
