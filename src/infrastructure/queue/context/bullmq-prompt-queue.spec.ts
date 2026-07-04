import { BullMqPromptQueue } from './bullmq-prompt-queue';

describe('BullMqPromptQueue', () => {
  it('enqueues the job with the correct name, payload, and options', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const promptQueue = new BullMqPromptQueue(queue as any);

    await promptQueue.enqueue({
      jobId: '507f1f77bcf86cd799439011',
      userId: 'user-1',
    });

    expect(queue.add).toHaveBeenCalledWith(
      'planning',
      { jobId: '507f1f77bcf86cd799439011', userId: 'user-1' },
      {
        jobId: '507f1f77bcf86cd799439011',
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  });
});
