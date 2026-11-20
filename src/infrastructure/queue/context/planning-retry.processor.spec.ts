import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { RetryPlanningJobUseCase } from '../../../application/context/retry-planning-job.use-case';
import { JobStatus, PlanningJob } from '../../../domain/context/planning-job';
import { PlanningRetryProcessor } from './planning-retry.processor';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

function makeJob(overrides: Partial<PlanningJob> = {}): PlanningJob {
  return new PlanningJob({
    id: 'job-1',
    userId: 'user-1',
    documentId: null,
    sectionId: null,
    status: JobStatus.Completed,
    prompt: 'Plan',
    connectors: [],
    result: { suggestions: ['ok'] },
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: new Date(),
    ...overrides,
  });
}

function setup(outcome: { processed: boolean; job: PlanningJob | null }) {
  const execute = jest.fn().mockResolvedValue(outcome);
  const useCase = { execute } as unknown as RetryPlanningJobUseCase;
  const emit = jest.fn();
  const processor = new PlanningRetryProcessor(useCase, {
    emit,
  } as unknown as EventEmitter2);
  const run = () =>
    processor.process({ data: { jobId: 'job-1', attempt: 1 } } as any);
  return { emit, run, execute };
}

describe('PlanningRetryProcessor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes jobId and attempt to the use case', async () => {
    const { run, execute } = setup({ processed: false, job: null });
    await run();
    expect(execute).toHaveBeenCalledWith({
      jobId: 'job-1',
      attempt: 1,
    });
  });

  it('emits planning.completed', async () => {
    const { emit, run } = setup({ processed: true, job: makeJob() });
    await run();
    expect(emit).toHaveBeenCalledWith('planning.completed', {
      jobId: 'job-1',
      userId: 'user-1',
      status: JobStatus.Completed,
      result: { suggestions: ['ok'] },
    });
  });

  it('emits planning.failed and reports an unexpected code to Sentry', async () => {
    const { emit, run } = setup({
      processed: true,
      job: makeJob({
        status: JobStatus.Failed,
        result: null,
        errorCode: 'AI_PROVIDER_UNAVAILABLE',
        errorMessage: 'down',
      }),
    });
    await run();
    expect(emit).toHaveBeenCalledWith('planning.failed', {
      jobId: 'job-1',
      userId: 'user-1',
      status: JobStatus.Failed,
      errorCode: 'AI_PROVIDER_UNAVAILABLE',
      errorMessage: 'down',
    });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('does not report AI_PROVIDER_RATE_LIMITED to Sentry', async () => {
    const { emit, run } = setup({
      processed: true,
      job: makeJob({
        status: JobStatus.Failed,
        result: null,
        errorCode: 'AI_PROVIDER_RATE_LIMITED',
        errorMessage: 'busy',
      }),
    });
    await run();
    expect(emit).toHaveBeenCalledWith('planning.failed', expect.any(Object));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('emits a retry planning.status when another retry is pending', async () => {
    const { emit, run } = setup({
      processed: true,
      job: makeJob({
        status: JobStatus.Planning,
        result: null,
        planningRetryCount: 2,
        nextRetryAt: new Date(Date.now() + 120_000),
      }),
    });
    await run();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'planning.status',
      expect.objectContaining({
        jobId: 'job-1',
        userId: 'user-1',
        status: JobStatus.Planning,
        retryCount: 2,
      }),
    );
  });

  it('emits nothing when the claim was a no-op', async () => {
    const { emit, run } = setup({ processed: false, job: null });
    await run();
    expect(emit).not.toHaveBeenCalled();
  });
});
