import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  PlanningJobRepository,
  UpdatePlanningJobStatusData,
} from '../../domain/context/planning-job.repository';
import { HandleGatherTimeoutUseCase } from './handle-gather-timeout.use-case';

class InMemoryPlanningJobRepository implements PlanningJobRepository {
  private readonly jobs = new Map<string, PlanningJob>();

  seed(job: PlanningJob): void {
    this.jobs.set(job.id, job);
  }

  create(): Promise<PlanningJob> {
    return Promise.reject(new Error('not implemented'));
  }

  findById(id: string): Promise<PlanningJob | null> {
    return Promise.resolve(this.jobs.get(id) ?? null);
  }

  updateStatus(
    id: string,
    patch: UpdatePlanningJobStatusData,
  ): Promise<PlanningJob | null> {
    const existing = this.jobs.get(id);
    if (!existing) return Promise.resolve(null);
    const updated = new PlanningJob({
      ...existing,
      status: patch.status,
      errorCode:
        patch.errorCode !== undefined ? patch.errorCode : existing.errorCode,
      errorMessage:
        patch.errorMessage !== undefined
          ? patch.errorMessage
          : existing.errorMessage,
      finishedAt:
        patch.finishedAt !== undefined ? patch.finishedAt : existing.finishedAt,
    });
    this.jobs.set(id, updated);
    return Promise.resolve(updated);
  }

  claimForProcessing(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }

  claimForGathering(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }

  appendResultChunk(): ReturnType<PlanningJobRepository['appendResultChunk']> {
    return Promise.reject(new Error('not implemented'));
  }

  claimForPlanning(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }

  failIfStillGathering(
    id: string,
    patch: { errorCode: string; errorMessage: string },
  ): Promise<PlanningJob | null> {
    // Atomic CAS, mirroring the real repository: only succeeds when the
    // job is still `gathering` — this is the guard the use-case now relies
    // on instead of a read-then-write.
    const existing = this.jobs.get(id);
    if (!existing || existing.status !== JobStatus.Gathering) {
      return Promise.resolve(null);
    }
    const failed = new PlanningJob({
      ...existing,
      status: JobStatus.Failed,
      errorCode: patch.errorCode,
      errorMessage: patch.errorMessage,
      finishedAt: new Date(),
    });
    this.jobs.set(id, failed);
    return Promise.resolve(failed);
  }
}

function makeJob(overrides: Partial<PlanningJob> = {}): PlanningJob {
  return new PlanningJob({
    id: 'job-1',
    userId: 'user-1',
    documentId: null,
    sectionId: null,
    status: JobStatus.Gathering,
    prompt: 'Plan my chapter',
    connectors: ['trello'],
    result: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    startedAt: new Date('2026-01-01T00:00:01.000Z'),
    finishedAt: null,
    ...overrides,
  });
}

describe('HandleGatherTimeoutUseCase', () => {
  it('fails a still-gathering job with CONTEXT_ENGINE_TIMEOUT', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new HandleGatherTimeoutUseCase(repository);

    const { timedOut, job } = await useCase.execute({ jobId: 'job-1' });

    expect(timedOut).toBe(true);
    expect(job?.status).toBe(JobStatus.Failed);
    expect(job?.errorCode).toBe('CONTEXT_ENGINE_TIMEOUT');
    expect(job?.finishedAt).not.toBeNull();
  });

  it('is a no-op when the job already moved past gathering (a real result won the race)', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob({ status: JobStatus.Completed }));
    const useCase = new HandleGatherTimeoutUseCase(repository);

    const { timedOut, job } = await useCase.execute({ jobId: 'job-1' });

    expect(timedOut).toBe(false);
    expect(job?.status).toBe(JobStatus.Completed);
  });

  it('is a no-op (job: null) when the job does not exist', async () => {
    const repository = new InMemoryPlanningJobRepository();
    const useCase = new HandleGatherTimeoutUseCase(repository);

    const { timedOut, job } = await useCase.execute({ jobId: 'missing' });

    expect(timedOut).toBe(false);
    expect(job).toBeNull();
  });

  it(
    'a timeout racing a real completion never contaminates the completed ' +
      'job with error fields (the atomic CAS, not a stale read, is the guard)',
    async () => {
      const repository = new InMemoryPlanningJobRepository();
      // Simulates HandleContextResultChunkUseCase's claimForPlanning having
      // already won the race and completed the job before this timeout
      // fires — failIfStillGathering's CAS (status === gathering) has
      // nothing left to claim.
      repository.seed(
        makeJob({
          status: JobStatus.Completed,
          result: { suggestions: ['already done'] },
          finishedAt: new Date('2026-01-01T00:05:00.000Z'),
        }),
      );
      const useCase = new HandleGatherTimeoutUseCase(repository);

      const { timedOut, job } = await useCase.execute({ jobId: 'job-1' });

      expect(timedOut).toBe(false);
      expect(job?.status).toBe(JobStatus.Completed);
      expect(job?.errorCode).toBeNull();
      expect(job?.errorMessage).toBeNull();
      expect(job?.result).toEqual({ suggestions: ['already done'] });
    },
  );
});
