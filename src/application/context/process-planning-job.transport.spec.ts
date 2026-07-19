import { Prompt } from '../../domain/ai/prompt.entity';
import { PromptRepository } from '../../domain/ai/prompt.repository';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { ContextGatherer } from '../../domain/context/context-gatherer.port';
import {
  ContextRequestPublisher,
  GatherRequestInput,
} from '../../domain/context/context-request-publisher.port';
import { GatherTimeoutScheduler } from '../../domain/context/gather-timeout-scheduler.port';
import {
  LlmPlanner,
  PlanningResult,
} from '../../domain/context/llm-planner.port';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  AppendResultChunkOutcome,
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
    return Promise.reject(new Error('not implemented — transport suite'));
  }

  claimForGathering(id: string): Promise<PlanningJob | null> {
    const existing = this.jobs.get(id);
    if (!existing || existing.status !== JobStatus.Pending) {
      return Promise.resolve(null);
    }
    const claimed = new PlanningJob({
      ...existing,
      status: JobStatus.Gathering,
      startedAt: new Date(),
    });
    this.jobs.set(id, claimed);
    return Promise.resolve(claimed);
  }

  appendResultChunk(): Promise<AppendResultChunkOutcome> {
    return Promise.reject(new Error('not implemented — transport suite'));
  }

  claimForPlanning(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented — transport suite'));
  }

  failIfStillGathering(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented — transport suite'));
  }
}

class FakePromptRepository implements PromptRepository {
  findActiveByFeatureType(): Promise<Prompt | null> {
    return Promise.resolve(null);
  }
}

class StubGatherer implements ContextGatherer {
  gather(): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error('legacy gatherer must not run in transport mode'),
    );
  }
}

class StubPlanner implements LlmPlanner {
  plan(): Promise<PlanningResult> {
    return Promise.reject(
      new Error('planner must not run before terminal chunk'),
    );
  }
}

class FakeContextRequestPublisher implements ContextRequestPublisher {
  public published: GatherRequestInput[] = [];
  private readonly shouldThrow: boolean;

  constructor(shouldThrow = false) {
    this.shouldThrow = shouldThrow;
  }

  publishGatherRequest(input: GatherRequestInput): Promise<void> {
    if (this.shouldThrow) {
      return Promise.reject(new Error('broker unavailable'));
    }
    this.published.push(input);
    return Promise.resolve();
  }
}

class FakeConnectorConnectionRepository implements ConnectorConnectionRepository {
  constructor(private readonly active: ConnectorConnection[]) {}
  findById(): ReturnType<ConnectorConnectionRepository['findById']> {
    return Promise.reject(new Error('not implemented'));
  }
  findByUserAndProvider(): ReturnType<
    ConnectorConnectionRepository['findByUserAndProvider']
  > {
    return Promise.reject(new Error('not implemented'));
  }
  findByComposioAccountId(): ReturnType<
    ConnectorConnectionRepository['findByComposioAccountId']
  > {
    return Promise.reject(new Error('not implemented'));
  }
  findAllByUser(): ReturnType<ConnectorConnectionRepository['findAllByUser']> {
    return Promise.reject(new Error('not implemented'));
  }
  findActiveByUser(): Promise<ConnectorConnection[]> {
    return Promise.resolve(this.active);
  }
  upsertInitiated(): ReturnType<
    ConnectorConnectionRepository['upsertInitiated']
  > {
    return Promise.reject(new Error('not implemented'));
  }
  updateStatus(): ReturnType<ConnectorConnectionRepository['updateStatus']> {
    return Promise.reject(new Error('not implemented'));
  }
}

function makeConnection(
  overrides: Partial<ConnectorConnection> = {},
): ConnectorConnection {
  return new ConnectorConnection({
    id: 'conn-1',
    userId: 'user-1',
    provider: ConnectorProvider.Trello,
    composioAccountId: 'ca_trello',
    status: ConnectorStatus.Active,
    connectedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

class FakeGatherTimeoutScheduler implements GatherTimeoutScheduler {
  public scheduled: { jobId: string; delayMs: number }[] = [];
  scheduleTimeout(input: { jobId: string; delayMs: number }): Promise<void> {
    this.scheduled.push(input);
    return Promise.resolve();
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
    connectors: ['trello'],
    result: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  });
}

describe('ProcessPlanningJobUseCase — RabbitMQ transport branch', () => {
  it('claims pending -> gathering, publishes the resolved gather request, and returns processed without running the legacy gatherer/planner', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const publisher = new FakeContextRequestPublisher();
    const connectorRepo = new FakeConnectorConnectionRepository([
      makeConnection(),
    ]);
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new StubPlanner(),
      new FakePromptRepository(),
      publisher,
      connectorRepo,
    );

    const { processed, job } = await useCase.execute({ jobId: 'job-1' });

    expect(processed).toBe(true);
    expect(job.status).toBe(JobStatus.Gathering);
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      prompt: 'Plan my chapter',
      connectors: [
        {
          provider: ConnectorProvider.Trello,
          mcpUrl: null,
          composioAccountId: 'ca_trello',
        },
      ],
    });
    expect(publisher.published[0].requestedAt).toBeInstanceOf(Date);
  });

  it('schedules the no-result timeout when a scheduler is provided', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const publisher = new FakeContextRequestPublisher();
    const connectorRepo = new FakeConnectorConnectionRepository([]);
    const scheduler = new FakeGatherTimeoutScheduler();
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new StubPlanner(),
      new FakePromptRepository(),
      publisher,
      connectorRepo,
      scheduler,
      90_000,
    );

    await useCase.execute({ jobId: 'job-1' });

    expect(scheduler.scheduled).toEqual([{ jobId: 'job-1', delayMs: 90_000 }]);
  });

  it('marks the job failed (CONTEXT_ENGINE_PUBLISH_FAILED) when publishing rejects, without scheduling a timeout', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const publisher = new FakeContextRequestPublisher(true);
    const connectorRepo = new FakeConnectorConnectionRepository([]);
    const scheduler = new FakeGatherTimeoutScheduler();
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new StubPlanner(),
      new FakePromptRepository(),
      publisher,
      connectorRepo,
      scheduler,
    );

    const { processed, job } = await useCase.execute({ jobId: 'job-1' });

    expect(processed).toBe(true);
    expect(job.status).toBe(JobStatus.Failed);
    expect(job.errorCode).toBe('CONTEXT_ENGINE_PUBLISH_FAILED');
    expect(job.errorMessage).toBe('broker unavailable');
    expect(scheduler.scheduled).toHaveLength(0);
  });

  it('is idempotent: an already-gathering job is a no-op (processed=false), never republished', async () => {
    const repository = new InMemoryPlanningJobRepository();
    const gatheringJob = makeJob({
      status: JobStatus.Gathering,
      startedAt: new Date('2026-01-01T00:01:00.000Z'),
    });
    repository.seed(gatheringJob);
    const publisher = new FakeContextRequestPublisher();
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new StubPlanner(),
      new FakePromptRepository(),
      publisher,
      new FakeConnectorConnectionRepository([]),
    );

    const { processed, job } = await useCase.execute({ jobId: 'job-1' });

    expect(processed).toBe(false);
    expect(job).toBe(gatheringJob);
    expect(publisher.published).toHaveLength(0);
  });

  it('throws NotFoundException when the job does not exist at all', async () => {
    const repository = new InMemoryPlanningJobRepository();
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new StubPlanner(),
      new FakePromptRepository(),
      new FakeContextRequestPublisher(),
      new FakeConnectorConnectionRepository([]),
    );

    await expect(useCase.execute({ jobId: 'missing' })).rejects.toThrow(
      'Planning job missing not found',
    );
  });

  it('publishes an empty connectors array when no active connections match the job', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob({ connectors: ['github'] }));
    const publisher = new FakeContextRequestPublisher();
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new StubGatherer(),
      new StubPlanner(),
      new FakePromptRepository(),
      publisher,
      new FakeConnectorConnectionRepository([]),
    );

    await useCase.execute({ jobId: 'job-1' });

    expect(publisher.published[0].connectors).toEqual([]);
  });
});
