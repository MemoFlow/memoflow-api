import { ServiceUnavailableException } from '@nestjs/common';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  CreatePlanningJobData,
  PlanningJobRepository,
  UpdatePlanningJobStatusData,
} from '../../domain/context/planning-job.repository';
import { PromptQueue } from '../../domain/context/prompt-queue';
import { SubmitPlanningJobUseCase } from './submit-planning-job.use-case';

class InMemoryPlanningJobRepository implements PlanningJobRepository {
  private readonly jobs = new Map<string, PlanningJob>();
  private nextId = 1;

  create(data: CreatePlanningJobData): Promise<PlanningJob> {
    const job = new PlanningJob({
      id: `job-${this.nextId++}`,
      userId: data.userId,
      documentId: data.documentId ?? null,
      sectionId: data.sectionId ?? null,
      status: JobStatus.Pending,
      prompt: data.prompt,
      connectors: data.connectors,
      result: null,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    });
    this.jobs.set(job.id, job);
    return Promise.resolve(job);
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
      result: patch.result !== undefined ? patch.result : existing.result,
      errorCode:
        patch.errorCode !== undefined ? patch.errorCode : existing.errorCode,
      errorMessage:
        patch.errorMessage !== undefined
          ? patch.errorMessage
          : existing.errorMessage,
      startedAt:
        patch.startedAt !== undefined ? patch.startedAt : existing.startedAt,
      finishedAt:
        patch.finishedAt !== undefined ? patch.finishedAt : existing.finishedAt,
    });
    this.jobs.set(id, updated);
    return Promise.resolve(updated);
  }

  claimForProcessing(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }
}

class StubPromptQueue implements PromptQueue {
  public enqueued: { jobId: string }[] = [];
  private readonly shouldThrow: boolean;

  constructor(shouldThrow = false) {
    this.shouldThrow = shouldThrow;
  }

  enqueue(job: { jobId: string }): Promise<void> {
    if (this.shouldThrow) {
      return Promise.reject(new Error('redis unavailable'));
    }
    this.enqueued.push(job);
    return Promise.resolve();
  }
}

describe('SubmitPlanningJobUseCase', () => {
  it('creates the job and enqueues it with the created id', async () => {
    const repository = new InMemoryPlanningJobRepository();
    const queue = new StubPromptQueue();
    const useCase = new SubmitPlanningJobUseCase(repository, queue);

    const result = await useCase.execute({
      userId: 'user-1',
      prompt: 'Plan my chapter',
      connectors: ['notion'],
    });

    expect(result.status).toBe(JobStatus.Pending);
    expect(queue.enqueued).toEqual([{ jobId: result.id }]);
  });

  it('marks the job failed and throws 503 when enqueue fails', async () => {
    const repository = new InMemoryPlanningJobRepository();
    const queue = new StubPromptQueue(true);
    const useCase = new SubmitPlanningJobUseCase(repository, queue);

    await expect(
      useCase.execute({ userId: 'user-1', prompt: 'Plan my chapter' }),
    ).rejects.toThrow(ServiceUnavailableException);

    // No orphaned pending job — the created job (deterministic first id in
    // this fake) must have been marked failed, not left pending.
    const job = await repository.findById('job-1');
    expect(job).not.toBeNull();
    expect(job?.status).toBe(JobStatus.Failed);
    expect(job?.errorCode).toBe('ENQUEUE_FAILED');
    expect(job?.finishedAt).not.toBeNull();
  });
});
