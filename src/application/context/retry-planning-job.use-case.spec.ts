import { InMemoryPromptRepository } from '../ai/testing-fakes';
import { SuggestionGeneratorRateLimitedError } from '../../domain/ai/suggestion-generation.errors';
import {
  LlmPlanner,
  PlanningResult,
} from '../../domain/context/llm-planner.port';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import { PlanningJobRepository } from '../../domain/context/planning-job.repository';
import {
  PlanningRetryScheduler,
  SchedulePlanningRetryInput,
} from '../../domain/context/planning-retry-scheduler.port';
import { PlanningRetryPolicy, planningRetryDelayMs } from './planning-retry';
import { RetryPlanningJobUseCase } from './retry-planning-job.use-case';
import { runClaimedPlanning } from './run-claimed-planning';
import { FakeUserRepository, makePipeline } from './testing-fakes';

const POLICY: PlanningRetryPolicy = {
  baseDelaysMs: [30_000, 120_000],
  maxDelayMs: 600_000,
};

function makeJob(): PlanningJob {
  return new PlanningJob({
    id: 'job-1',
    userId: 'user-1',
    documentId: null,
    sectionId: null,
    status: JobStatus.Planning,
    prompt: 'plan',
    connectors: [],
    result: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
  });
}

/** Only the methods the planning phase and the retry claim use. */
function makeRepo(job: PlanningJob) {
  const state = { job };
  const repo = {
    state,
    findById: () => Promise.resolve(state.job),
    updateStatus: (_id: string, patch: Record<string, unknown>) => {
      state.job = Object.assign(
        Object.create(PlanningJob.prototype) as PlanningJob,
        state.job,
        patch,
      );
      return Promise.resolve(state.job);
    },
    scheduleRetry: (
      _id: string,
      p: {
        expectedRetryCount: number;
        nextRetryAt: Date;
        contextUsed: Record<string, unknown>;
        promptVersion: string | null;
      },
    ) => {
      const j = state.job;
      const inFlight =
        j.status === JobStatus.Planning || j.status === JobStatus.Running;
      if (!inFlight || j.planningRetryCount !== p.expectedRetryCount) {
        return Promise.resolve(null);
      }
      j.planningRetryCount += 1;
      j.nextRetryAt = p.nextRetryAt;
      j.contextUsed = p.contextUsed;
      return Promise.resolve(j);
    },
    claimPlanningRetry: (_id: string, count: number) => {
      const j = state.job;
      const inFlight =
        j.status === JobStatus.Planning || j.status === JobStatus.Running;
      if (!inFlight || j.planningRetryCount !== count || !j.nextRetryAt) {
        return Promise.resolve(null);
      }
      j.nextRetryAt = null;
      return Promise.resolve(j);
    },
  };
  return repo as typeof repo & PlanningJobRepository;
}

class FlakyPlanner implements LlmPlanner {
  calls = 0;
  constructor(
    private readonly failures: number,
    private readonly retryAfter?: number,
  ) {}
  plan(): Promise<PlanningResult> {
    this.calls += 1;
    if (this.calls <= this.failures) {
      return Promise.reject(
        new SuggestionGeneratorRateLimitedError('limited', this.retryAfter),
      );
    }
    return Promise.resolve({
      suggestions: ['ok'],
      outline: null,
      sources: [],
      model: 'm',
    });
  }
}

describe('planning rate-limit retry', () => {
  function setup(planner: LlmPlanner, job = makeJob()) {
    const repo = makeRepo(job);
    const scheduled: SchedulePlanningRetryInput[] = [];
    const scheduler: PlanningRetryScheduler = {
      scheduleRetry: (i) => {
        scheduled.push(i);
        return Promise.resolve();
      },
    };
    const deps = {
      planningJobRepository: repo,
      planningPipeline: makePipeline(planner),
      promptRepository: new InMemoryPromptRepository(),
      userRepository: new FakeUserRepository(),
      logger: { error: jest.fn(), warn: jest.fn() },
      retry: { scheduler, policy: POLICY },
    };
    const useCase = new RetryPlanningJobUseCase(
      repo,
      deps.planningPipeline,
      deps.promptRepository,
      deps.userRepository,
      scheduler,
      POLICY,
    );
    return { repo, scheduled, deps, useCase };
  }

  it('computes delays: base, Retry-After above it, capped', () => {
    expect(planningRetryDelayMs(POLICY, 1)).toBe(30_000);
    expect(planningRetryDelayMs(POLICY, 1, 5)).toBe(30_000);
    expect(planningRetryDelayMs(POLICY, 1, 90)).toBe(90_000);
    expect(planningRetryDelayMs(POLICY, 2)).toBe(120_000);
    expect(planningRetryDelayMs(POLICY, 2, 99_999)).toBe(600_000);
  });

  it('parks the job (non-terminal) on the first rate limit and schedules retry 1', async () => {
    const { repo, scheduled, deps } = setup(new FlakyPlanner(5));
    const job = await runClaimedPlanning(deps, repo.state.job, {
      chunks: [{ content: 'ctx' }],
    });

    expect(job.status).toBe(JobStatus.Planning);
    expect(job.planningRetryCount).toBe(1);
    expect(job.nextRetryAt).toBeInstanceOf(Date);
    expect(job.errorCode).toBeNull();
    expect(scheduled).toEqual([
      { jobId: 'job-1', attempt: 1, delayMs: 30_000 },
    ]);
  });

  it('retries with the stored connector context, then completes', async () => {
    const planner = new FlakyPlanner(1);
    const { repo, scheduled, deps, useCase } = setup(planner);
    await runClaimedPlanning(deps, repo.state.job, {
      chunks: [{ content: 'ctx' }],
    });
    expect(repo.state.job.contextUsed).toMatchObject({
      chunks: [{ content: 'ctx' }],
    });

    const result = await useCase.execute({ jobId: 'job-1', attempt: 1 });

    expect(result.processed).toBe(true);
    expect(result.job?.status).toBe(JobStatus.Completed);
    expect(planner.calls).toBe(2);
    expect(scheduled).toHaveLength(1);
  });

  it('fails with AI_PROVIDER_RATE_LIMITED once both retries are used', async () => {
    const { repo, scheduled, deps, useCase } = setup(new FlakyPlanner(10, 50));
    await runClaimedPlanning(deps, repo.state.job, {});
    const second = await useCase.execute({ jobId: 'job-1', attempt: 1 });
    expect(second.job?.status).toBe(JobStatus.Planning);
    const third = await useCase.execute({ jobId: 'job-1', attempt: 2 });

    expect(third.job?.status).toBe(JobStatus.Failed);
    expect(third.job?.errorCode).toBe('AI_PROVIDER_RATE_LIMITED');
    expect(scheduled.map((s) => s.delayMs)).toEqual([50_000, 120_000]);
  });

  it('is a no-op for a duplicate delivery or a terminal job', async () => {
    const planner = new FlakyPlanner(1);
    const { repo, deps, useCase } = setup(planner);
    await runClaimedPlanning(deps, repo.state.job, {});
    await useCase.execute({ jobId: 'job-1', attempt: 1 });
    const calls = planner.calls;

    const dup = await useCase.execute({ jobId: 'job-1', attempt: 1 });
    expect(dup.processed).toBe(false);
    expect(planner.calls).toBe(calls);
  });

  it('does not retry when the user was disabled meanwhile', async () => {
    const { repo, deps } = setup(new FlakyPlanner(1));
    await runClaimedPlanning(deps, repo.state.job, {});
    const useCase = new RetryPlanningJobUseCase(
      repo,
      deps.planningPipeline,
      deps.promptRepository,
      new FakeUserRepository(new Set(['user-1'])),
      deps.retry.scheduler,
      POLICY,
    );
    const result = await useCase.execute({ jobId: 'job-1', attempt: 1 });
    expect(result.job?.status).toBe(JobStatus.Failed);
    expect(result.job?.errorCode).toBe('USER_INACTIVE');
  });

  it('fails immediately when no scheduler is bound', async () => {
    const { repo, deps } = setup(new FlakyPlanner(1));
    const job = await runClaimedPlanning(
      { ...deps, retry: undefined },
      repo.state.job,
      {},
    );
    expect(job.status).toBe(JobStatus.Failed);
    expect(job.errorCode).toBe('AI_PROVIDER_RATE_LIMITED');
  });

  it('fails the job when the enqueue itself fails', async () => {
    const { repo, deps } = setup(new FlakyPlanner(1));
    const job = await runClaimedPlanning(
      {
        ...deps,
        retry: {
          policy: POLICY,
          scheduler: {
            scheduleRetry: () => Promise.reject(new Error('redis')),
          },
        },
      },
      repo.state.job,
      {},
    );
    expect(job.status).toBe(JobStatus.Failed);
  });

  it('ends the job as failed (not stuck) when the planning phase throws', async () => {
    const { repo, deps } = setup(new FlakyPlanner(1));
    await runClaimedPlanning(deps, repo.state.job, {});
    const broken = new RetryPlanningJobUseCase(
      repo,
      deps.planningPipeline,
      {
        findActiveByFeatureType: () => Promise.reject(new Error('db down')),
      } as never,
      deps.userRepository,
      deps.retry.scheduler,
      POLICY,
    );
    // Make the failure escape runClaimedPlanning's own catch: its failed
    // write throws once.
    const original: typeof repo.updateStatus = repo.updateStatus.bind(repo);
    let thrown = false;
    repo.updateStatus = (id: string, patch: Record<string, unknown>) => {
      if (!thrown) {
        thrown = true;
        return Promise.reject(new Error('mongo blip'));
      }
      return original(id, patch);
    };

    const result = await broken.execute({ jobId: 'job-1', attempt: 1 });

    expect(result.processed).toBe(true);
    expect(result.job?.status).toBe(JobStatus.Failed);
    expect(result.job?.errorCode).toBe('PROCESSING_FAILED');
    expect(repo.state.job.status).toBe(JobStatus.Failed);
  });

  it('rolls back the pending retry when the enqueue fails, then fails the job', async () => {
    const { repo, deps } = setup(new FlakyPlanner(1));
    const job = await runClaimedPlanning(
      {
        ...deps,
        retry: {
          policy: POLICY,
          scheduler: {
            scheduleRetry: () => Promise.reject(new Error('redis')),
          },
        },
      },
      repo.state.job,
      {},
    );
    expect(job.status).toBe(JobStatus.Failed);
    expect(repo.state.job.nextRetryAt).toBeNull();
  });

  it('does not overwrite a job that went terminal while the retry was being scheduled', async () => {
    const { repo, scheduled, deps } = setup(new FlakyPlanner(5));
    const claimed = repo.state.job;
    // Another actor completes the job before our schedule CAS runs.
    repo.state.job = Object.assign(
      Object.create(PlanningJob.prototype) as PlanningJob,
      claimed,
      { status: JobStatus.Completed, result: { suggestions: ['done'] } },
    );
    const updateStatus = jest.spyOn(repo, 'updateStatus');

    const job = await runClaimedPlanning(deps, claimed, {});

    expect(job.status).toBe(JobStatus.Completed);
    expect(updateStatus).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });
});
