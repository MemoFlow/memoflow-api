import { BullMqPlanningRetryScheduler } from './bullmq-planning-retry.scheduler';

describe('BullMqPlanningRetryScheduler', () => {
  it('schedules a delayed job with a deterministic per-attempt id', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const scheduler = new BullMqPlanningRetryScheduler(queue as any);

    await scheduler.scheduleRetry({
      jobId: 'job-1',
      attempt: 2,
      delayMs: 120_000,
    });

    expect(queue.add).toHaveBeenCalledWith(
      'planning-retry',
      { jobId: 'job-1', attempt: 2 },
      {
        jobId: 'planning-retry-job-1-2',
        delay: 120_000,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  });
});
