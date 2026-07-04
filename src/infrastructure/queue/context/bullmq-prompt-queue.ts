import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PromptQueue } from '../../../domain/context/prompt-queue';

@Injectable()
export class BullMqPromptQueue implements PromptQueue {
  constructor(@InjectQueue('planning') private readonly queue: Queue) {}

  async enqueue(job: { jobId: string; userId: string }): Promise<void> {
    // The Mongo _id doubles as the BullMQ jobId so retries/re-enqueues of the
    // same planning job dedupe instead of creating a second queue entry, and
    // the worker can correlate a BullMQ job back to its `planning_jobs` doc.
    // `userId` rides along in the job data so the processor can emit
    // owner-scoped WebSocket events without an extra Mongo read.
    await this.queue.add(
      'planning',
      { jobId: job.jobId, userId: job.userId },
      {
        jobId: job.jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
}
