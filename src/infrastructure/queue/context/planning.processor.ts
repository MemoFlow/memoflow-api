import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { Job } from 'bullmq';
import { ProcessPlanningJobUseCase } from '../../../application/context/process-planning-job.use-case';
import { JobStatus } from '../../../domain/context/planning-job';

/**
 * Thin BullMQ adapter: deserializes the job payload, delegates all
 * orchestration to `ProcessPlanningJobUseCase`, then emits the completion
 * event via EventEmitter2. This is the ONLY place `planning.*` events are
 * emitted — the use-case stays framework-pure.
 */
@Processor('planning')
export class PlanningProcessor extends WorkerHost {
  private readonly logger = new Logger(PlanningProcessor.name);

  constructor(
    private readonly processPlanningJob: ProcessPlanningJobUseCase,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<{ jobId: string; userId: string }>): Promise<void> {
    const { jobId, userId } = job.data;

    try {
      const { processed, job: finalJob } =
        await this.processPlanningJob.execute({
          jobId,
        });

      if (!processed) {
        // Nothing to do: already running/gathering (another worker) or
        // already terminal (stalled-job retry replaying a finished job) —
        // emitting here would be a spurious/duplicate event for a job whose
        // outcome was already announced.
        return;
      }

      // `Running` for the legacy synchronous path (by the time we get here
      // its gather+plan has already completed, so this is purely an
      // "in-flight" progress signal preceding the completed/failed event
      // below). `Gathering` for the RabbitMQ transport path — there,
      // `finalJob` genuinely IS still in `gathering` at this point (the
      // terminal transition happens later, asynchronously, via
      // `HandleContextResultChunkUseCase`/`ContextResultsConsumer`).
      this.eventEmitter.emit('planning.status', {
        jobId,
        userId,
        status:
          finalJob.status === JobStatus.Gathering
            ? JobStatus.Gathering
            : JobStatus.Running,
      });

      if (finalJob.status === JobStatus.Completed) {
        this.eventEmitter.emit('planning.completed', {
          jobId,
          userId,
          status: finalJob.status,
          result: finalJob.result,
        });
      } else if (finalJob.status === JobStatus.Failed) {
        // Handled failure (gather/plan/publish error caught inside
        // ProcessPlanningJobUseCase and recorded as a terminal `failed`
        // status) — never hits the HTTP filter, so report it here.
        // finalJob.errorMessage is a string, not an Error, so wrap it.
        Sentry.captureException(
          new Error(finalJob.errorMessage ?? 'Planning job failed'),
          { extra: { jobId, userId, errorCode: finalJob.errorCode } },
        );
        this.eventEmitter.emit('planning.failed', {
          jobId,
          userId,
          status: finalJob.status,
          errorCode: finalJob.errorCode,
          errorMessage: finalJob.errorMessage,
        });
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Planning job processing failed';
      this.logger.error(
        `Unexpected failure processing planning job ${jobId}: ${errorMessage}`,
      );
      // No manual Sentry.captureException here: @sentry/nestjs's BullMQ
      // instrumentation wraps `process()` (see `SentryModule.forRoot()` in
      // app.module.ts) and auto-captures any error that propagates out of
      // it — and this catch block rethrows below, so a manual capture here
      // would double-report the same exception. The handled-failure branch
      // above (`finalJob.status === JobStatus.Failed`) is the one that
      // needs a manual capture, because that path returns normally and the
      // auto-instrumentation never sees it.
      this.eventEmitter.emit('planning.failed', {
        jobId,
        userId,
        status: JobStatus.Failed,
        errorCode: 'PROCESSING_FAILED',
        errorMessage,
      });
      // Rethrow so BullMQ records the failure (retries/backoff per the
      // producer's job options).
      throw err;
    }
  }
}
