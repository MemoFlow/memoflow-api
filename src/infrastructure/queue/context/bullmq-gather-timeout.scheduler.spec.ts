import { BullMqGatherTimeoutScheduler } from './bullmq-gather-timeout.scheduler';

describe('BullMqGatherTimeoutScheduler', () => {
  it('schedules a delayed, retried job keyed by jobId (dedupe)', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const scheduler = new BullMqGatherTimeoutScheduler(queue as any);

    await scheduler.scheduleTimeout({ jobId: 'job-1', delayMs: 120_000 });

    expect(queue.add).toHaveBeenCalledWith(
      'gather-timeout',
      { jobId: 'job-1' },
      {
        jobId: 'job-1',
        delay: 120_000,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  });
});
