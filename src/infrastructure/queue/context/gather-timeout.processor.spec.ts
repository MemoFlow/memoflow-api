import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { HandleGatherTimeoutUseCase } from '../../../application/context/handle-gather-timeout.use-case';
import { JobStatus, PlanningJob } from '../../../domain/context/planning-job';
import { GatherTimeoutProcessor } from './gather-timeout.processor';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

function makeJob(overrides: Partial<PlanningJob> = {}): PlanningJob {
  return new PlanningJob({
    id: 'job-1',
    userId: 'user-1',
    documentId: null,
    sectionId: null,
    status: JobStatus.Failed,
    prompt: 'Plan my chapter',
    connectors: [],
    result: null,
    errorCode: 'CONTEXT_ENGINE_TIMEOUT',
    errorMessage: 'timed out',
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: new Date(),
    ...overrides,
  });
}

describe('GatherTimeoutProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits planning.failed when the job actually timed out', async () => {
    const handleGatherTimeout = {
      execute: jest.fn().mockResolvedValue({ timedOut: true, job: makeJob() }),
    } as unknown as HandleGatherTimeoutUseCase;
    const emit = jest.fn();
    const eventEmitter = { emit } as unknown as EventEmitter2;
    const processor = new GatherTimeoutProcessor(
      handleGatherTimeout,
      eventEmitter,
    );

    await processor.process({ data: { jobId: 'job-1' } } as any);

    expect(emit).toHaveBeenCalledWith('planning.failed', {
      jobId: 'job-1',
      userId: 'user-1',
      status: JobStatus.Failed,
      errorCode: 'CONTEXT_ENGINE_TIMEOUT',
      errorMessage: 'timed out',
    });
  });

  it('reports the timeout to Sentry when the job actually timed out', async () => {
    const handleGatherTimeout = {
      execute: jest.fn().mockResolvedValue({ timedOut: true, job: makeJob() }),
    } as unknown as HandleGatherTimeoutUseCase;
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const processor = new GatherTimeoutProcessor(
      handleGatherTimeout,
      eventEmitter,
    );

    await processor.process({ data: { jobId: 'job-1' } } as any);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('emits nothing when the job did not time out (a real result already won the race)', async () => {
    const handleGatherTimeout = {
      execute: jest.fn().mockResolvedValue({
        timedOut: false,
        job: makeJob({ status: JobStatus.Completed }),
      }),
    } as unknown as HandleGatherTimeoutUseCase;
    const emit = jest.fn();
    const eventEmitter = { emit } as unknown as EventEmitter2;
    const processor = new GatherTimeoutProcessor(
      handleGatherTimeout,
      eventEmitter,
    );

    await processor.process({ data: { jobId: 'job-1' } } as any);

    expect(emit).not.toHaveBeenCalled();
  });

  it('does NOT report to Sentry when the job did not time out', async () => {
    const handleGatherTimeout = {
      execute: jest.fn().mockResolvedValue({
        timedOut: false,
        job: makeJob({ status: JobStatus.Completed }),
      }),
    } as unknown as HandleGatherTimeoutUseCase;
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const processor = new GatherTimeoutProcessor(
      handleGatherTimeout,
      eventEmitter,
    );

    await processor.process({ data: { jobId: 'job-1' } } as any);

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
