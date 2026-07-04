import { NotFoundException } from '@nestjs/common';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import { PlanningJobRepository } from '../../domain/context/planning-job.repository';
import { GetPlanningJobUseCase } from './get-planning-job.use-case';

class InMemoryPlanningJobRepository implements PlanningJobRepository {
  constructor(private readonly jobs: PlanningJob[] = []) {}

  findById(id: string): Promise<PlanningJob | null> {
    return Promise.resolve(this.jobs.find((j) => j.id === id) ?? null);
  }

  create(): Promise<PlanningJob> {
    return Promise.reject(new Error('not implemented'));
  }

  updateStatus(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }

  claimForProcessing(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }
}

function makeJob(overrides: Partial<PlanningJob> = {}): PlanningJob {
  return new PlanningJob({
    id: 'job-1',
    userId: 'user-1',
    documentId: null,
    sectionId: null,
    status: JobStatus.Pending,
    prompt: 'Plan my chapter',
    connectors: [],
    result: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  });
}

describe('GetPlanningJobUseCase', () => {
  it('returns the job when the requesting user owns it', async () => {
    const job = makeJob();
    const useCase = new GetPlanningJobUseCase(
      new InMemoryPlanningJobRepository([job]),
    );

    const result = await useCase.execute({ jobId: 'job-1', userId: 'user-1' });

    expect(result).toBe(job);
  });

  it('throws NotFoundException when the job does not exist', async () => {
    const useCase = new GetPlanningJobUseCase(
      new InMemoryPlanningJobRepository([]),
    );

    await expect(
      useCase.execute({ jobId: 'missing', userId: 'user-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException (not Forbidden) when a different user requests the job, to avoid leaking existence', async () => {
    const job = makeJob({ userId: 'user-1' });
    const useCase = new GetPlanningJobUseCase(
      new InMemoryPlanningJobRepository([job]),
    );

    await expect(
      useCase.execute({ jobId: 'job-1', userId: 'user-2' }),
    ).rejects.toThrow(NotFoundException);
  });
});
