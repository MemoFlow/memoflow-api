import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { Prompt } from '../../../domain/ai/prompt.entity';
import { PromptRepository } from '../../../domain/ai/prompt.repository';
import { ConnectorConnection } from '../../../domain/connectors/connector-connection.entity';
import { ConnectorConnectionRepository } from '../../../domain/connectors/connector-connection.repository';
import { ContextGatherer } from '../../../domain/context/context-gatherer.port';
import {
  ContextRequestPublisher,
  GatherRequestInput,
} from '../../../domain/context/context-request-publisher.port';
import {
  LlmPlanner,
  PlanningResult,
} from '../../../domain/context/llm-planner.port';
import { JobStatus, PlanningJob } from '../../../domain/context/planning-job';
import {
  AppendResultChunkOutcome,
  PlanningJobRepository,
  UpdatePlanningJobStatusData,
} from '../../../domain/context/planning-job.repository';
import { ProcessPlanningJobUseCase } from '../../../application/context/process-planning-job.use-case';
import { PlanningProcessor } from './planning.processor';

/**
 * A fake that mirrors the REAL repository's atomic contracts
 * (`claimForGathering`: only from `pending`; `claimForProcessing`: legacy
 * `pending -> running` claim). `claimForProcessing` throwing (rather than
 * silently no-oping) is deliberate: this spec's whole point is to catch the
 * exact ordering bug the reviewer suspected — if `ProcessPlanningJobUseCase`
 * (or anything upstream of it) ever ran the legacy claim ahead of
 * `claimForGathering` on the transport branch, this fake surfaces it as a
 * loud test failure instead of a silent `processed: false` no-op.
 */
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
    return Promise.reject(
      new Error(
        'claimForProcessing (legacy pending -> running) must never run ' +
          'when a ContextRequestPublisher is wired — this IS the ordering ' +
          'bug this spec guards against.',
      ),
    );
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
    return Promise.reject(new Error('not implemented'));
  }

  claimForPlanning(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }

  failIfStillGathering(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }
}

class FakePromptRepository implements PromptRepository {
  findActiveByFeatureType(): Promise<Prompt | null> {
    return Promise.resolve(null);
  }
}

class UnreachableGatherer implements ContextGatherer {
  gather(): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(
        'legacy ContextGatherer must never run on the transport branch',
      ),
    );
  }
}

class UnreachablePlanner implements LlmPlanner {
  plan(): Promise<PlanningResult> {
    return Promise.reject(
      new Error('legacy LlmPlanner must never run before a terminal chunk'),
    );
  }
}

class FakeContextRequestPublisher implements ContextRequestPublisher {
  public published: GatherRequestInput[] = [];
  publishGatherRequest(input: GatherRequestInput): Promise<void> {
    this.published.push(input);
    return Promise.resolve();
  }
}

class FakeConnectorConnectionRepository implements ConnectorConnectionRepository {
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
    return Promise.resolve([]);
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

describe('PlanningProcessor + ProcessPlanningJobUseCase, wired exactly as production DI would', () => {
  it(
    'with a ContextRequestPublisher bound (RABBITMQ_URL set), claims ' +
      'pending -> gathering DIRECTLY (no prior claimForProcessing/running ' +
      'hop), publishes the gather request, and emits planning.status(gathering)',
    async () => {
      const repository = new InMemoryPlanningJobRepository();
      repository.seed(makeJob());
      const publisher = new FakeContextRequestPublisher();
      const useCase = new ProcessPlanningJobUseCase(
        repository,
        new UnreachableGatherer(),
        new UnreachablePlanner(),
        new FakePromptRepository(),
        publisher,
        new FakeConnectorConnectionRepository(),
      );
      const eventEmitter = new EventEmitter2();
      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      const processor = new PlanningProcessor(useCase, eventEmitter);

      await processor.process({
        data: { jobId: 'job-1', userId: 'user-1' },
      } as Job<{ jobId: string; userId: string }>);

      // The publish actually happened — this is the concrete symptom the
      // reviewer's ordering theory predicted would be missing.
      expect(publisher.published).toHaveLength(1);
      expect(publisher.published[0].jobId).toBe('job-1');

      const job = await repository.findById('job-1');
      expect(job?.status).toBe(JobStatus.Gathering);

      expect(emitSpy).toHaveBeenCalledWith('planning.status', {
        jobId: 'job-1',
        userId: 'user-1',
        status: JobStatus.Gathering,
      });
      // Never the legacy "in-flight" signal — proves the transport branch,
      // not the legacy branch, actually ran.
      expect(emitSpy).not.toHaveBeenCalledWith(
        'planning.status',
        expect.objectContaining({ status: JobStatus.Running }),
      );
      expect(emitSpy).not.toHaveBeenCalledWith(
        'planning.completed',
        expect.anything(),
      );
    },
  );

  it('a second, redundant process() call for the same job is a race-safe no-op (never republishes)', async () => {
    const repository = new InMemoryPlanningJobRepository();
    repository.seed(makeJob());
    const publisher = new FakeContextRequestPublisher();
    const useCase = new ProcessPlanningJobUseCase(
      repository,
      new UnreachableGatherer(),
      new UnreachablePlanner(),
      new FakePromptRepository(),
      publisher,
      new FakeConnectorConnectionRepository(),
    );
    const eventEmitter = new EventEmitter2();
    const processor = new PlanningProcessor(useCase, eventEmitter);

    await processor.process({
      data: { jobId: 'job-1', userId: 'user-1' },
    } as Job<{ jobId: string; userId: string }>);
    await processor.process({
      data: { jobId: 'job-1', userId: 'user-1' },
    } as Job<{ jobId: string; userId: string }>);

    expect(publisher.published).toHaveLength(1);
  });
});
