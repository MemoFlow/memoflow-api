import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PlanningRetryScheduler,
  SchedulePlanningRetryInput,
} from '../../../domain/context/planning-retry-scheduler.port';

export const PLANNING_RETRY_QUEUE_NAME = 'planning-retry';

/**
 * `PlanningRetryScheduler` as a BullMQ delayed job (mirrors
 * `BullMqGatherTimeoutScheduler`). The job id is deterministic per
 * `(job, attempt)` so a duplicate schedule dedupes; `attempts`/`backoff`
 * only cover delivery of the retry job (e.g. a worker crash before the
 * claim). Once the use case has claimed the retry it never throws, so a
 * redelivery after the claim is a no-op.
 */
@Injectable()
export class BullMqPlanningRetryScheduler implements PlanningRetryScheduler {
  constructor(
    @InjectQueue(PLANNING_RETRY_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  async scheduleRetry(input: SchedulePlanningRetryInput): Promise<void> {
    await this.queue.add(
      'planning-retry',
      { jobId: input.jobId, attempt: input.attempt },
      {
        // BullMQ rejects ':' in custom ids on some versions; use '-'.
        jobId: `planning-retry-${input.jobId}-${input.attempt}`,
        delay: input.delayMs,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
}
