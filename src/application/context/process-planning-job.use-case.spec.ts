import {
  AiQuotaExceededError,
  AiQuotaUnavailableError,
} from '../../domain/ai/ai-quota.errors';
import { Prompt } from '../../domain/ai/prompt.entity';
import {
  ContextGatherer,
  STUB_CONTEXT_NOTE,
} from '../../domain/context/context-gatherer.port';
import {
  LlmPlanner,
  PlanInput,
  PlanningResult,
} from '../../domain/context/llm-planner.port';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  CreatePlanningJobData,
  PlanningJobRepository,
  UpdatePlanningJobStatusData,
} from '../../domain/context/planning-job.repository';
import { ProcessPlanningJobUseCase } from './process-planning-job.use-case';
import { InMemoryPromptRepository, makePrompt } from '../ai/testing-fakes';
import {
  FakeSectionRetriever,
  FakeUserRepository,
  makePipeline,
} from './testing-fakes';

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
      model: patch.model !== undefined ? patch.model : existing.model,
      contextUsed:
        patch.contextUsed !== undefined
          ? patch.contextUsed
          : existing.contextUsed,
    });
  }
}

const NO_RETRIEVAL = {
  sources: [],
  matched: 0,
  used: 0,
  dropped: 0,
  truncated: 0,
  failed: false,
};

class FakePromptRepository extends InMemoryPromptRepository {}

function makePlanningPrompt(overrides: Partial<Prompt> = {}): Prompt {
  return makePrompt({
    featureType: 'planning',
    version: 'v1',
    systemTemplate: 'SYS <untrusted_{{nonce}}>',
    template: 'Plan this: {{prompt}} | {{context}} | {{nonce}}',
    userInvocable: false,
    ...overrides,
  });
}

class StubGatherer implements ContextGatherer {
  gather(): Promise<Record<string, unknown>> {
    return Promise.resolve({ note: STUB_CONTEXT_NOTE });
  }
}

class ThrowingGatherer implements ContextGatherer {
  gather(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error('connector unavailable'));
  }
}

class StubPlanner implements LlmPlanner {
  plan(input: PlanInput): Promise<PlanningResult> {
    return Promise.resolve({
      suggestions: [`(stub plan) ${input.prompt}`],
      outline: null,
      sources: [],
      model: 'test/planner',
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
      makePipeline(new StubPlanner()),
      new FakePromptRepository([makePlanningPrompt()]),
      new FakeUserRepository(),
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
    expect(job.model).toBe('test/planner');
    expect(job.contextUsed).toEqual({
      note: STUB_CONTEXT_NOTE,
      retrieval: NO_RETRIEVAL,
    });
  });

  it('records promptVersion null when no active planning prompt is configured', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      makePipeline(new StubPlanner()),
      new FakePromptRepository([]),
      new FakeUserRepository(),
    );

    const { job } = await useCase.execute({ jobId: 'job-1' });

    expect(job.promptVersion).toBeNull();
  });

  it('passes the rendered system and user prompts to the planner', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob({ prompt: 'costs $& {{nonce}}' }));
    const planner = new StubPlanner();
    const planSpy = jest.spyOn(planner, 'plan');
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      makePipeline(planner),
      new FakePromptRepository([makePlanningPrompt()]),
      new FakeUserRepository(),
    );

    await useCase.execute({ jobId: 'job-1' });

    const input = planSpy.mock.calls[0][0];
    const nonce = /^SYS <untrusted_([0-9a-f]{32})>$/.exec(input.system)?.[1];
    expect(nonce).toBeDefined();
    // The stub gatherer's placeholder is not presented as a source.
    expect(input.user).toBe(`Plan this: costs $& {{nonce}} |  | ${nonce}`);
  });

  it('falls back to the built-in planning prompt when none is active', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const planner = new StubPlanner();
    const planSpy = jest.spyOn(planner, 'plan');
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      makePipeline(planner),
      new FakePromptRepository([]),
      new FakeUserRepository(),
    );

    const { job } = await useCase.execute({ jobId: 'job-1' });

    expect(job.status).toBe(JobStatus.Completed);
    expect(job.promptVersion).toBeNull();
    const input = planSpy.mock.calls[0][0];
    expect(input.system).toContain("MemoFlow's writing assistant");
    expect(input.user).toContain('Plan my chapter');
  });

  it('marks the job failed when the active prompt cannot be rendered', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const planner = new StubPlanner();
    const planSpy = jest.spyOn(planner, 'plan');
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      makePipeline(planner),
      new FakePromptRepository([makePlanningPrompt({ template: '{{nope}}' })]),
      new FakeUserRepository(),
    );

    const { job } = await useCase.execute({ jobId: 'job-1' });

    expect(job.status).toBe(JobStatus.Failed);
    expect(job.errorMessage).toBe('Planning job processing failed');
    expect(job.promptVersion).toBe('v1');
    expect(planSpy).not.toHaveBeenCalled();
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
      makePipeline(new ThrowingPlanner()),
      new FakePromptRepository([makePlanningPrompt()]),
      new FakeUserRepository(),
    );

    const { job } = await useCase.execute({ jobId: 'job-1' });

    expect(job.status).toBe(JobStatus.Failed);
    expect(job.contextUsed).toEqual({
      note: STUB_CONTEXT_NOTE,
      retrieval: NO_RETRIEVAL,
    });
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
      makePipeline(new StubPlanner()),
      new FakePromptRepository([makePlanningPrompt()]),
      new FakeUserRepository(),
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
      makePipeline(new StubPlanner()),
      new FakePromptRepository([makePlanningPrompt()]),
      new FakeUserRepository(),
    );

    const { processed, job } = await useCase.execute({ jobId: 'job-1' });

    expect(processed).toBe(true);
    expect(job.status).toBe(JobStatus.Failed);
    expect(job.errorCode).toBe('PROCESSING_FAILED');
    // A raw error message never reaches the job (clients read it).
    expect(job.errorMessage).toBe('Planning job processing failed');
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
      makePipeline(new StubPlanner()),
      new FakePromptRepository([makePlanningPrompt()]),
      new FakeUserRepository(),
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
      makePipeline(new StubPlanner()),
      new FakePromptRepository([makePlanningPrompt()]),
      new FakeUserRepository(),
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
      makePipeline(new StubPlanner()),
      new FakePromptRepository([makePlanningPrompt()]),
      new FakeUserRepository(),
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
      makePipeline(new StubPlanner()),
      new FakePromptRepository([makePlanningPrompt()]),
      new FakeUserRepository(),
    );

    await expect(useCase.execute({ jobId: 'missing' })).rejects.toThrow(
      'Planning job missing not found',
    );
  });

  it('fails the job with a fixed message when the planner echoes the nonce', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const planner: LlmPlanner = {
      plan: (input) =>
        Promise.resolve({
          suggestions: [
            `leak ${/untrusted_([0-9a-f]{32})/.exec(input.system)![1]}`,
          ],
          outline: null,
          sources: [],
          model: 'm',
        }),
    };
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      makePipeline(planner),
      new FakePromptRepository([makePlanningPrompt()]),
      new FakeUserRepository(),
    );

    const job = (await useCase.execute({ jobId: 'job-1' })).job;

    expect(job.status).toBe(JobStatus.Failed);
    expect(job.errorMessage).toBe(
      'The AI planner returned a result that was rejected',
    );
    expect(job.result).toBeNull();
  });

  describe('inactive user', () => {
    it.each([
      ['disabled', new FakeUserRepository(new Set(['user-1']))],
      ['deleted', new FakeUserRepository(new Set(), new Set(['user-1']))],
    ])(
      'fails the job with USER_INACTIVE for a %s user, before gather, retrieval or planning',
      async (_name, users) => {
        const repository = new InMemoryPlanningJobRepository();
        repository.seed(makeJob());
        const gatherer = new StubGatherer();
        const gather = jest.spyOn(gatherer, 'gather');
        const planner = new StubPlanner();
        const plan = jest.spyOn(planner, 'plan');
        const retriever = new FakeSectionRetriever();
        const useCase = new ProcessPlanningJobUseCase(
          repository,
          gatherer,
          makePipeline(planner, retriever),
          new FakePromptRepository([makePlanningPrompt()]),
          users,
        );

        const { processed, job } = await useCase.execute({ jobId: 'job-1' });

        expect(processed).toBe(true);
        expect(job.status).toBe(JobStatus.Failed);
        expect(job.errorCode).toBe('USER_INACTIVE');
        expect(job.errorMessage).toBe(
          'The account that submitted this job is not active',
        );
        expect(gather).not.toHaveBeenCalled();
        expect(retriever.calls).toHaveLength(0);
        expect(plan).not.toHaveBeenCalled();
      },
    );

    it('runs normally for an active user', async () => {
      const repository = new InMemoryPlanningJobRepository();
      repository.seed(makeJob());
      const users = new FakeUserRepository();
      const useCase = new ProcessPlanningJobUseCase(
        repository,
        new StubGatherer(),
        makePipeline(new StubPlanner()),
        new FakePromptRepository([makePlanningPrompt()]),
        users,
      );

      const { job } = await useCase.execute({ jobId: 'job-1' });

      expect(job.status).toBe(JobStatus.Completed);
      expect(users.lookups).toEqual(['user-1']);
    });
  });

  describe('quota failures', () => {
    it.each([
      [
        new AiQuotaExceededError(60),
        'AI_QUOTA_EXCEEDED',
        'Daily AI usage limit reached. Try again later.',
      ],
      [
        new AiQuotaUnavailableError(),
        'AI_QUOTA_UNAVAILABLE',
        'AI usage limits are temporarily unavailable',
      ],
    ])(
      'records %p as %s with a fixed message',
      async (error, code, message) => {
        const repository = new InMemoryPlanningJobRepository();
        repository.seed(makeJob());
        const planner: LlmPlanner = { plan: () => Promise.reject(error) };
        const useCase = new ProcessPlanningJobUseCase(
          repository,
          new StubGatherer(),
          makePipeline(planner),
          new FakePromptRepository([makePlanningPrompt()]),
          new FakeUserRepository(),
        );

        const { job } = await useCase.execute({ jobId: 'job-1' });

        expect(job.status).toBe(JobStatus.Failed);
        expect(job.errorCode).toBe(code);
        expect(job.errorMessage).toBe(message);
      },
    );

    it('passes the job owner to the planner', async () => {
      const repository = new InMemoryPlanningJobRepository();
      repository.seed(makeJob({ userId: 'user-9' }));
      const planner = new StubPlanner();
      const plan = jest.spyOn(planner, 'plan');
      const useCase = new ProcessPlanningJobUseCase(
        repository,
        new StubGatherer(),
        makePipeline(planner),
        new FakePromptRepository([makePlanningPrompt()]),
        new FakeUserRepository(),
      );

      await useCase.execute({ jobId: 'job-1' });

      expect(plan.mock.calls[0][0].userId).toBe('user-9');
    });
  });
});
