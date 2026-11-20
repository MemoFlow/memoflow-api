import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { Job } from 'bullmq';
import { isExpectedFailureCode } from '../../../application/context/planning-prompt';
import {
  isAwaitingRetry,
  retryStatusEvent,
} from '../../../application/context/planning-retry';
import { RetryPlanningJobUseCase } from '../../../application/context/retry-planning-job.use-case';
import { JobStatus } from '../../../domain/context/planning-job';
import { PLANNING_RETRY_QUEUE_NAME } from './bullmq-planning-retry.scheduler';

/**
 * Thin BullMQ adapter for the delayed planning retry: delegates to
 * `RetryPlanningJobUseCase`, then emits the `planning.*` events for the
 * outcome (completed, failed, or another retry scheduled).
 */
@Processor(PLANNING_RETRY_QUEUE_NAME)
export class PlanningRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(PlanningRetryProcessor.name);

  constructor(
    private readonly retryPlanningJob: RetryPlanningJobUseCase,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<{ jobId: string; attempt: number }>): Promise<void> {
    const { jobId, attempt } = job.data;
    const { processed, job: finalJob } = await this.retryPlanningJob.execute({
      jobId,
      attempt,
    });
    if (!processed || !finalJob) return;

    if (finalJob.status === JobStatus.Completed) {
      this.eventEmitter.emit('planning.completed', {
        jobId,
        userId: finalJob.userId,
        status: finalJob.status,
        result: finalJob.result,
      });
    } else if (finalJob.status === JobStatus.Failed) {
      this.logger.warn(`Planning job ${jobId} failed after retry ${attempt}`);
      if (!isExpectedFailureCode(finalJob.errorCode)) {
        Sentry.captureException(
          new Error(finalJob.errorMessage ?? 'Planning job failed'),
          {
            extra: {
              jobId,
              userId: finalJob.userId,
              errorCode: finalJob.errorCode,
            },
          },
        );
      }
      this.eventEmitter.emit('planning.failed', {
        jobId,
        userId: finalJob.userId,
        status: finalJob.status,
        errorCode: finalJob.errorCode,
        errorMessage: finalJob.errorMessage,
      });
    } else if (isAwaitingRetry(finalJob)) {
      this.eventEmitter.emit('planning.status', retryStatusEvent(finalJob));
    }
  }
}
