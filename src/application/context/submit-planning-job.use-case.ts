import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import { PLANNING_JOB_REPOSITORY } from '../../domain/context/planning-job.repository';
import type { PlanningJobRepository } from '../../domain/context/planning-job.repository';
import { PROMPT_QUEUE } from '../../domain/context/prompt-queue';
import type { PromptQueue } from '../../domain/context/prompt-queue';

export interface SubmitPlanningJobInput {
  userId: string;
  prompt: string;
  connectors?: string[];
}

/**
 * Creates the `planning_jobs` row (pending) and dispatches it to the queue.
 * `userId` comes from the JWT-authenticated request — `JwtStrategy` already
 * loads the PG `User` via `GetUserByIdUseCase` on every request, so the
 * cross-DB reference this use-case writes into Mongo is validated upstream.
 */
@Injectable()
export class SubmitPlanningJobUseCase {
  private readonly logger = new Logger(SubmitPlanningJobUseCase.name);

  constructor(
    @Inject(PLANNING_JOB_REPOSITORY)
    private readonly planningJobRepository: PlanningJobRepository,
    @Inject(PROMPT_QUEUE)
    private readonly promptQueue: PromptQueue,
  ) {}

  async execute(input: SubmitPlanningJobInput): Promise<PlanningJob> {
    const created = await this.planningJobRepository.create({
      userId: input.userId,
      prompt: input.prompt,
      connectors: input.connectors ?? [],
    });

    try {
      await this.promptQueue.enqueue({ jobId: created.id });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to enqueue job';
      this.logger.error(
        `Failed to enqueue planning job ${created.id}: ${errorMessage}`,
      );
      // No orphaned `pending` job — mark it failed so it never looks like
      // it's silently in flight, then surface 503 to the caller. Guarded in
      // its own try/catch so a second Mongo hiccup here can't mask the 503
      // behind an unrelated 500.
      try {
        await this.planningJobRepository.updateStatus(created.id, {
          status: JobStatus.Failed,
          errorCode: 'ENQUEUE_FAILED',
          errorMessage,
          finishedAt: new Date(),
        });
      } catch (updateErr) {
        const updateErrorMessage =
          updateErr instanceof Error
            ? updateErr.message
            : 'Failed to mark job as failed';
        this.logger.error(
          `Failed to mark planning job ${created.id} as failed after enqueue failure: ${updateErrorMessage}`,
        );
      }
      throw new ServiceUnavailableException(
        'Failed to submit planning job for processing',
      );
    }

    return created;
  }
}
