import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  GatherTimeoutScheduler,
  ScheduleGatherTimeoutInput,
} from '../../../domain/context/gather-timeout-scheduler.port';

export const GATHER_TIMEOUT_QUEUE_NAME = 'ctx-gather-timeout';

/**
 * `GatherTimeoutScheduler` implementation — a BullMQ delayed job on the
 * existing queue infra (deliberately not a bare `setTimeout`, so the
 * timeout survives a process restart; see `docs/contracts/context-engine.md`
 * §4). Only bound by `ContextModule` when `RABBITMQ_URL` is configured.
 */
@Injectable()
export class BullMqGatherTimeoutScheduler implements GatherTimeoutScheduler {
  constructor(
    @InjectQueue(GATHER_TIMEOUT_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  async scheduleTimeout(input: ScheduleGatherTimeoutInput): Promise<void> {
    // `jobId: input.jobId` dedupes: re-scheduling for the same planning job
    // (shouldn't happen, but a safe no-op if it does) reuses the existing
    // delayed job rather than creating a second one — same convention as
    // `BullMqPromptQueue.enqueue`. `attempts`/`backoff` mirror the
    // `planning` queue's producer (`BullMqPromptQueue`): a single transient
    // Mongo error processing this job must not permanently disable the
    // no-result timeout guard for it. `removeOnFail: 100` (not `true`) for
    // the same reason `planning` uses it — a job that exhausts all retries
    // stays inspectable instead of vanishing silently.
    await this.queue.add(
      'gather-timeout',
      { jobId: input.jobId },
      {
        jobId: input.jobId,
        delay: input.delayMs,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
}
