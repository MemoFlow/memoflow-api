import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { Job } from 'bullmq';
import { HandleGatherTimeoutUseCase } from '../../../application/context/handle-gather-timeout.use-case';
import { GATHER_TIMEOUT_QUEUE_NAME } from './bullmq-gather-timeout.scheduler';

/**
 * Thin BullMQ adapter for the gather-timeout delayed job — same convention
 * as `PlanningProcessor`: delegates all orchestration to
 * `HandleGatherTimeoutUseCase`, then emits `planning.failed` if (and only
 * if) this call actually timed the job out.
 */
@Processor(GATHER_TIMEOUT_QUEUE_NAME)
export class GatherTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(GatherTimeoutProcessor.name);

  constructor(
    private readonly handleGatherTimeout: HandleGatherTimeoutUseCase,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<void> {
    const { jobId } = job.data;
    const { timedOut, job: planningJob } =
      await this.handleGatherTimeout.execute({ jobId });

    if (!timedOut || !planningJob) {
      // Already terminal (a real result won the race) or missing entirely —
      // safe no-op, nothing to announce.
      return;
    }

    this.logger.warn(
      `Planning job ${jobId} timed out waiting on context gather`,
    );
    // Async surface: `process()` returns normally here (no throw), so
    // @sentry/nestjs's BullMQ auto-instrumentation — which only captures
    // errors that propagate out of `process()` — never sees this timeout
    // failure, and it never reaches HttpExceptionFilter either. No Error
    // object is in hand (this is a timeout, not a caught exception), so
    // wrap the recorded reason. Mirrors PlanningProcessor's handled-failure
    // branch.
    Sentry.captureException(
      new Error(planningJob.errorMessage ?? 'Planning job timed out'),
      {
        extra: {
          jobId,
          userId: planningJob.userId,
          errorCode: planningJob.errorCode,
        },
      },
    );
    this.eventEmitter.emit('planning.failed', {
      jobId: planningJob.id,
      userId: planningJob.userId,
      status: planningJob.status,
      errorCode: planningJob.errorCode,
      errorMessage: planningJob.errorMessage,
    });
  }
}
