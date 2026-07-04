import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanningJob } from '../../domain/context/planning-job';
import { PLANNING_JOB_REPOSITORY } from '../../domain/context/planning-job.repository';
import type { PlanningJobRepository } from '../../domain/context/planning-job.repository';

export interface GetPlanningJobInput {
  jobId: string;
  userId: string;
}

/**
 * Reads a planning job, scoped to its owner. Used by the REST fallback
 * (`GET /planning-jobs/:id`) and, later, WS catch-up.
 */
@Injectable()
export class GetPlanningJobUseCase {
  constructor(
    @Inject(PLANNING_JOB_REPOSITORY)
    private readonly planningJobRepository: PlanningJobRepository,
  ) {}

  async execute(input: GetPlanningJobInput): Promise<PlanningJob> {
    const job = await this.planningJobRepository.findById(input.jobId);
    // A missing job and a job owned by someone else both 404 — never leak
    // whether another user's job id exists.
    if (!job || job.userId !== input.userId) {
      throw new NotFoundException(`Planning job ${input.jobId} not found`);
    }
    return job;
  }
}
