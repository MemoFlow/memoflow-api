import { Prompt } from '../../domain/ai/prompt.entity';
import { PromptRepository } from '../../domain/ai/prompt.repository';
import { ContextGatherer } from '../../domain/context/context-gatherer.port';
import {
  LlmPlanner,
  PlanningResult,
} from '../../domain/context/llm-planner.port';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  CreatePlanningJobData,
  PlanningJobRepository,
  UpdatePlanningJobStatusData,
} from '../../domain/context/planning-job.repository';
import { ProcessPlanningJobUseCase } from './process-planning-job.use-case';

class InMemoryPlanningJobRepository implements PlanningJobRepository {
  private readonly jobs = new Map<string, PlanningJob>();

  seed(job: PlanningJob): void {
    this.jobs.set(job.id, job);
  }

  create(data: CreatePlanningJobData): Promise<PlanningJob> {
    const job = new PlanningJob({
      id: 'job-1',
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
    const updated = this.applyPatch(existing, patch);
    this.jobs.set(id, updated);
    return Promise.resolve(updated);
  }

  claimForProcessing(id: string): Promise<PlanningJob | null> {
    const existing = this.jobs.get(id);
    if (!existing || existing.status !== JobStatus.Pending) {
      // Mirrors the real atomic `findOneAndUpdate` filter: only a `pending`
      // job can be claimed.
      return Promise.resolve(null);
    }
    const claimed = this.applyPatch(existing, {
      status: JobStatus.Running,
      startedAt: new Date(),
    });
    this.jobs.set(id, claimed);
    return Promise.resolve(claimed);
  }

  claimForGathering(): Promise<PlanningJob | null> {
    return Promise.reject(
      new Error('not implemented — this suite only exercises the legacy path'),
    );
  }

  appendResultChunk(): ReturnType<PlanningJobRepository['appendResultChunk']> {
    return Promise.reject(
      new Error('not implemented — this suite only exercises the legacy path'),
    );
  }

  claimForPlanning(): Promise<PlanningJob | null> {
    return Promise.reject(
      new Error('not implemented — this suite only exercises the legacy path'),
    );
  }

  failIfStillGathering(): Promise<PlanningJob | null> {
    return Promise.reject(
      new Error('not implemented — this suite only exercises the legacy path'),
    );
  }

  private applyPatch(
    existing: PlanningJob,
    patch: UpdatePlanningJobStatusData,
  ): PlanningJob {
    return new PlanningJob({
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
      promptVersion:
        patch.promptVersion !== undefined
          ? patch.promptVersion
          : existing.promptVersion,
      contextUsed:
        patch.contextUsed !== undefined
          ? patch.contextUsed
          : existing.contextUsed,
    });
  }
}

class FakePromptRepository implements PromptRepository {
  constructor(private readonly prompts: Prompt[] = []) {}

  findActiveByFeatureType(featureType: string): Promise<Prompt | null> {
    return Promise.resolve(
      this.prompts.find((p) => p.featureType === featureType && p.isActive) ??
        null,
    );
  }
}

function makePlanningPrompt(overrides: Partial<Prompt> = {}): Prompt {
  return new Prompt({
    id: 'prompt-1',
    featureType: 'planning',
    version: 'v1',
    template: 'Plan this: {{prompt}}',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

class StubGatherer implements ContextGatherer {
  gather(): Promise<Record<string, unknown>> {
    return Promise.resolve({ note: 'stub' });
  }
}

class ThrowingGatherer implements ContextGatherer {
  gather(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error('connector unavailable'));
  }
}

class StubPlanner implements LlmPlanner {
  plan(input: { prompt: string }): Promise<PlanningResult> {
    return Promise.resolve({
      suggestions: [`(stub plan) ${input.prompt}`],
      outline: null,
      sources: [],
    });
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

describe('ProcessPlanningJobUseCase', () => {
  it('claims a pending job and moves it to completed with the echo result', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new StubPlanner(),
      new FakePromptRepository([makePlanningPrompt()]),
    );

    const { processed, job } = await useCase.execute({ jobId: 'job-1' });

    expect(processed).toBe(true);
    expect(job.status).toBe(JobStatus.Completed);
    expect(job.result).toEqual({
      suggestions: ['(stub plan) Plan my chapter'],
      outline: null,
      sources: [],
    });
    expect(job.finishedAt).not.toBeNull();
    expect(job.promptVersion).toBe('v1');
    expect(job.contextUsed).toEqual({ note: 'stub' });
  });

  it('records promptVersion null when no active planning prompt is configured', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new StubPlanner(),
      new FakePromptRepository([]),
    );

    const { job } = await useCase.execute({ jobId: 'job-1' });

    expect(job.promptVersion).toBeNull();
  });

  it('records contextUsed on a failed job when gather succeeded but plan threw', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    class ThrowingPlanner implements LlmPlanner {
      plan(): Promise<PlanningResult> {
        return Promise.reject(new Error('planner exploded'));
      }
    }
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new ThrowingPlanner(),
      new FakePromptRepository([makePlanningPrompt()]),
    );

    const { job } = await useCase.execute({ jobId: 'job-1' });

    expect(job.status).toBe(JobStatus.Failed);
    expect(job.contextUsed).toEqual({ note: 'stub' });
    expect(job.promptVersion).toBe('v1');
  });

  it('passes { userId, connectors, prompt } to the gatherer', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(
      makeJob({ userId: 'user-42', connectors: ['trello', 'notion'] }),
    );
    const gatherer = new StubGatherer();
    const gatherSpy = jest.spyOn(gatherer, 'gather');
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      gatherer,
      new StubPlanner(),
      new FakePromptRepository([makePlanningPrompt()]),
    );

    await useCase.execute({ jobId: 'job-1' });

    expect(gatherSpy).toHaveBeenCalledWith({
      userId: 'user-42',
      connectors: ['trello', 'notion'],
      prompt: 'Plan my chapter',
    });
  });

  it('marks the job failed (without rethrowing) when the planner/gatherer throws', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new ThrowingGatherer(),
      new StubPlanner(),
      new FakePromptRepository([makePlanningPrompt()]),
    );

    const { processed, job } = await useCase.execute({ jobId: 'job-1' });

    expect(processed).toBe(true);
    expect(job.status).toBe(JobStatus.Failed);
    expect(job.errorCode).toBe('PROCESSING_FAILED');
    expect(job.errorMessage).toBe('connector unavailable');
  });

  it('is idempotent: an already-completed job is returned unchanged with processed=false, and gather/plan are never called', async () => {
    const repository = new InMemoryPlanningJobRepository();
    const terminalJob = makeJob({
      status: JobStatus.Completed,
      result: { suggestions: ['already done'] },
      finishedAt: new Date('2026-01-01T00:05:00.000Z'),
    });
    repository.seed(terminalJob);
    const gatherer = new StubGatherer();
    const gatherSpy = jest.spyOn(gatherer, 'gather');
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      gatherer,
      new StubPlanner(),
      new FakePromptRepository([makePlanningPrompt()]),
    );

    const { processed, job } = await useCase.execute({ jobId: 'job-1' });

    expect(processed).toBe(false);
    expect(job).toBe(terminalJob);
    expect(gatherSpy).not.toHaveBeenCalled();
  });

  it('is idempotent: an already-failed job is returned unchanged with processed=false', async () => {
    const repository = new InMemoryPlanningJobRepository();
    const terminalJob = makeJob({
      status: JobStatus.Failed,
      errorCode: 'PROCESSING_FAILED',
      errorMessage: 'boom',
      finishedAt: new Date('2026-01-01T00:05:00.000Z'),
    });
    repository.seed(terminalJob);
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new StubPlanner(),
      new FakePromptRepository([makePlanningPrompt()]),
    );

    const { processed, job } = await useCase.execute({ jobId: 'job-1' });

    expect(processed).toBe(false);
    expect(job).toBe(terminalJob);
  });

  it('is race-safe: a job already claimed (running) by another worker is a no-op, gather/plan never called', async () => {
    const repository = new InMemoryPlanningJobRepository();
    const runningJob = makeJob({
      status: JobStatus.Running,
      startedAt: new Date('2026-01-01T00:01:00.000Z'),
    });
    repository.seed(runningJob);
    const gatherer = new StubGatherer();
    const gatherSpy = jest.spyOn(gatherer, 'gather');
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      gatherer,
      new StubPlanner(),
      new FakePromptRepository([makePlanningPrompt()]),
    );

    const { processed, job } = await useCase.execute({ jobId: 'job-1' });

    expect(processed).toBe(false);
    expect(job).toBe(runningJob);
    expect(gatherSpy).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the job does not exist at all', async () => {
    const repository = new InMemoryPlanningJobRepository();
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new StubPlanner(),
      new FakePromptRepository([makePlanningPrompt()]),
    );

    await expect(useCase.execute({ jobId: 'missing' })).rejects.toThrow(
      'Planning job missing not found',
    );
  });
});
