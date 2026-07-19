import { Prompt } from '../../domain/ai/prompt.entity';
import { PromptRepository } from '../../domain/ai/prompt.repository';
import { ContextResultChunk } from '../../domain/context/context-result-chunk';
import {
  LlmPlanner,
  PlanningResult,
} from '../../domain/context/llm-planner.port';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  AppendResultChunkData,
  AppendResultChunkOutcome,
  PlanningJobRepository,
  UpdatePlanningJobStatusData,
} from '../../domain/context/planning-job.repository';
import { HandleContextResultChunkUseCase } from './handle-context-result-chunk.use-case';

class InMemoryPlanningJobRepository implements PlanningJobRepository {
  private readonly jobs = new Map<string, PlanningJob>();
  private readonly sequencesSeen = new Map<string, Set<number>>();

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
      result: patch.result !== undefined ? patch.result : existing.result,
      errorCode:
        patch.errorCode !== undefined ? patch.errorCode : existing.errorCode,
      errorMessage:
        patch.errorMessage !== undefined
          ? patch.errorMessage
          : existing.errorMessage,
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
    this.jobs.set(id, updated);
    return Promise.resolve(updated);
  }

  claimForProcessing(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }

  claimForGathering(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }

  appendResultChunk(
    id: string,
    chunk: AppendResultChunkData,
  ): Promise<AppendResultChunkOutcome> {
    const existing = this.jobs.get(id);
    if (!existing) return Promise.resolve({ applied: false, job: null });

    const seen = this.sequencesSeen.get(id) ?? new Set<number>();
    if (seen.has(chunk.sequence)) {
      return Promise.resolve({ applied: false, job: existing });
    }
    seen.add(chunk.sequence);
    this.sequencesSeen.set(id, seen);

    let updated = existing;
    if (chunk.type === 'data' && chunk.data) {
      updated = new PlanningJob({
        ...existing,
        dataChunks: [
          ...existing.dataChunks,
          {
            sequence: chunk.sequence,
            provider: chunk.data.provider,
            content: chunk.data.content,
            tokenEstimate: chunk.data.tokenEstimate ?? null,
          },
        ],
      });
      this.jobs.set(id, updated);
    }
    return Promise.resolve({ applied: true, job: updated });
  }

  claimForPlanning(
    id: string,
    contextUsed: Record<string, unknown>,
  ): Promise<PlanningJob | null> {
    // Atomic CAS, mirroring the real repository: the synchronous
    // check-and-mutate below can never interleave with another call's (JS
    // is single-threaded) — exactly one caller ever sees `Gathering` here,
    // even when two `execute()` calls race via `Promise.all`.
    const existing = this.jobs.get(id);
    if (!existing || existing.status !== JobStatus.Gathering) {
      return Promise.resolve(null);
    }
    const claimed = new PlanningJob({
      ...existing,
      status: JobStatus.Planning,
      contextUsed,
    });
    this.jobs.set(id, claimed);
    return Promise.resolve(claimed);
  }

  failIfStillGathering(
    id: string,
    patch: { errorCode: string; errorMessage: string },
  ): Promise<PlanningJob | null> {
    // Same CAS guard as `claimForPlanning`, failure side.
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

class FakePromptRepository implements PromptRepository {
  constructor(private readonly prompt: Prompt | null = null) {}
  findActiveByFeatureType(): Promise<Prompt | null> {
    return Promise.resolve(this.prompt);
  }
}

function makePlanningPrompt(): Prompt {
  return new Prompt({
    id: 'prompt-1',
    featureType: 'planning',
    version: 'v2',
    template: 'Plan this: {{prompt}}',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
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

class ThrowingPlanner implements LlmPlanner {
  plan(): Promise<PlanningResult> {
    return Promise.reject(new Error('planner exploded'));
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

function dataChunk(
  overrides: Partial<Extract<ContextResultChunk, { type: 'data' }>> = {},
): ContextResultChunk {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    userId: 'user-1',
    sequence: 0,
    type: 'data',
    data: { provider: 'trello', content: '{"cards":[]}', tokenEstimate: 42 },
    ...overrides,
  };
}

function statusChunk(
  phase: 'started' | 'gathering' | 'completed' | 'failed',
  overrides: Partial<
    Extract<ContextResultChunk, { type: 'status' }>['status']
  > = {},
  sequence = 1,
): ContextResultChunk {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    userId: 'user-1',
    sequence,
    type: 'status',
    status: { phase, ...overrides },
  };
}

describe('HandleContextResultChunkUseCase', () => {
  it('returns unknown-job when job_id matches no planning job', async () => {
    const repository = new InMemoryPlanningJobRepository();
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      new StubPlanner(),
      new FakePromptRepository(),
    );

    const result = await useCase.execute({ chunk: dataChunk() });

    expect(result.outcome).toBe('unknown-job');
    expect(result.job).toBeNull();
  });

  it("returns ownership-mismatch when the chunk's user_id doesn't match the job's", async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob({ userId: 'owner-1' }));
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      new StubPlanner(),
      new FakePromptRepository(),
    );

    const result = await useCase.execute({
      chunk: dataChunk({ userId: 'someone-else' }),
    });

    expect(result.outcome).toBe('ownership-mismatch');
  });

  it('returns duplicate (no-op) for any chunk against an already-terminal job', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob({ status: JobStatus.Completed }));
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      new StubPlanner(),
      new FakePromptRepository(),
    );

    const result = await useCase.execute({ chunk: dataChunk({ sequence: 5 }) });

    expect(result.outcome).toBe('duplicate');
  });

  it('applies a data chunk, accumulating it without changing job status', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      new StubPlanner(),
      new FakePromptRepository(),
    );

    const result = await useCase.execute({ chunk: dataChunk() });

    expect(result.outcome).toBe('applied');
    expect(result.terminal).toBe(false);
    expect(result.job?.status).toBe(JobStatus.Gathering);
    expect(result.job?.dataChunks).toEqual([
      {
        sequence: 0,
        provider: 'trello',
        content: '{"cards":[]}',
        tokenEstimate: 42,
      },
    ]);
  });

  it('ignores a duplicate sequence (same chunk redelivered)', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      new StubPlanner(),
      new FakePromptRepository(),
    );

    await useCase.execute({ chunk: dataChunk() });
    const second = await useCase.execute({ chunk: dataChunk() });

    expect(second.outcome).toBe('duplicate');
    expect(second.job?.dataChunks).toHaveLength(1);
  });

  it('applies a non-terminal status chunk (started/gathering) without ending the job', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      new StubPlanner(),
      new FakePromptRepository(),
    );

    const result = await useCase.execute({
      chunk: statusChunk('gathering', {}, 0),
    });

    expect(result.outcome).toBe('applied');
    expect(result.terminal).toBe(false);
    expect(result.job?.status).toBe(JobStatus.Gathering);
  });

  it('terminates on phase, not type: a status chunk with phase completed assembles context, plans, and completes the job', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const planner = new StubPlanner();
    const planSpy = jest.spyOn(planner, 'plan');
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      planner,
      new FakePromptRepository(makePlanningPrompt()),
    );

    await useCase.execute({ chunk: dataChunk({ sequence: 0 }) });
    await useCase.execute({
      chunk: dataChunk({
        sequence: 1,
        data: { provider: 'notion', content: '{"pages":[]}' },
      }),
    });
    const result = await useCase.execute({
      chunk: statusChunk('completed', {}, 2),
    });

    expect(result.outcome).toBe('applied');
    expect(result.terminal).toBe(true);
    expect(result.job?.status).toBe(JobStatus.Completed);
    expect(result.job?.promptVersion).toBe('v2');
    expect(result.job?.contextUsed).toEqual({
      chunks: [
        { provider: 'trello', content: '{"cards":[]}', tokenEstimate: 42 },
        { provider: 'notion', content: '{"pages":[]}', tokenEstimate: null },
      ],
    });
    expect(planSpy).toHaveBeenCalledWith({
      prompt: 'Plan my chapter',
      context: result.job?.contextUsed,
    });
    expect(result.job?.result).toEqual({
      suggestions: ['(stub plan) Plan my chapter'],
      outline: null,
      sources: [],
    });
  });

  it('a non-terminal status chunk never triggers termination even though type is status', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const planner = new StubPlanner();
    const planSpy = jest.spyOn(planner, 'plan');
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      planner,
      new FakePromptRepository(),
    );

    await useCase.execute({ chunk: statusChunk('started', {}, 0) });
    await useCase.execute({ chunk: statusChunk('gathering', {}, 1) });

    expect(planSpy).not.toHaveBeenCalled();
  });

  it('fails the job with the chunk error_code on a terminal failed status chunk', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      new StubPlanner(),
      new FakePromptRepository(),
    );

    const result = await useCase.execute({
      chunk: statusChunk(
        'failed',
        { errorCode: 'MCP_UNAVAILABLE', message: 'Trello MCP unreachable' },
        0,
      ),
    });

    expect(result.outcome).toBe('applied');
    expect(result.terminal).toBe(true);
    expect(result.job?.status).toBe(JobStatus.Failed);
    expect(result.job?.errorCode).toBe('MCP_UNAVAILABLE');
    expect(result.job?.errorMessage).toBe('Trello MCP unreachable');
  });

  it('marks the job failed (PROCESSING_FAILED) when the planner throws after a completed terminal chunk', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      new ThrowingPlanner(),
      new FakePromptRepository(),
    );

    const result = await useCase.execute({
      chunk: statusChunk('completed', {}, 0),
    });

    expect(result.job?.status).toBe(JobStatus.Failed);
    expect(result.job?.errorCode).toBe('PROCESSING_FAILED');
    expect(result.job?.errorMessage).toBe('planner exploded');
  });

  it('is defensively idempotent against a second terminal chunk with a different sequence (job already past gathering)', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const useCase = new HandleContextResultChunkUseCase(
      repository,
      new StubPlanner(),
      new FakePromptRepository(),
    );

    await useCase.execute({ chunk: statusChunk('completed', {}, 0) });
    const second = await useCase.execute({
      chunk: statusChunk('failed', { errorCode: 'SHOULD_NOT_APPLY' }, 1),
    });

    expect(second.outcome).toBe('duplicate');
    expect(second.job?.status).toBe(JobStatus.Completed);
  });

  it(
    'two concurrent, distinct-sequence terminal chunks (completed + failed) ' +
      'race to finalize the same job — exactly one wins, the planner runs at ' +
      'most once, and the loser relays nothing',
    async () => {
      const repository = new InMemoryPlanningJobRepository();
      repository.seed(makeJob());
      const planner = new StubPlanner();
      const planSpy = jest.spyOn(planner, 'plan');
      const useCase = new HandleContextResultChunkUseCase(
        repository,
        planner,
        new FakePromptRepository(makePlanningPrompt()),
      );

      // Both fire "at the same time" (no earlier terminal chunk has run
      // yet) — the atomic claimForPlanning/failIfStillGathering CAS in the
      // repository, not read-then-write in the use-case, is what must
      // guarantee only one of these ever finalizes.
      const [completedResult, failedResult] = await Promise.all([
        useCase.execute({ chunk: statusChunk('completed', {}, 0) }),
        useCase.execute({
          chunk: statusChunk('failed', { errorCode: 'RACE_LOSER' }, 1),
        }),
      ]);

      const outcomes = [completedResult, failedResult];
      const terminalOutcomes = outcomes.filter((r) => r.terminal);
      const duplicateOutcomes = outcomes.filter(
        (r) => r.outcome === 'duplicate',
      );

      // Exactly one call actually finalized the job; the other is a no-op.
      expect(terminalOutcomes).toHaveLength(1);
      expect(duplicateOutcomes).toHaveLength(1);

      // The planner ran at most once — no double-processing regardless of
      // which side won.
      expect(planSpy.mock.calls.length).toBeLessThanOrEqual(1);

      // The job settled on exactly one terminal status — never left
      // straddling both outcomes.
      const finalJob = await repository.findById('job-1');
      expect([JobStatus.Completed, JobStatus.Failed]).toContain(
        finalJob?.status,
      );

      if (finalJob?.status === JobStatus.Completed) {
        expect(planSpy).toHaveBeenCalledTimes(1);
        expect(finalJob.errorCode).toBeNull();
      } else {
        expect(planSpy).not.toHaveBeenCalled();
        expect(finalJob?.errorCode).toBe('RACE_LOSER');
      }
    },
  );
});
