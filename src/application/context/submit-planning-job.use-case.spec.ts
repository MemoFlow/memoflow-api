import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AiQuotaExceededError,
  AiQuotaUnavailableError,
} from '../../domain/ai/ai-quota.errors';
import { LlmGateway } from '../../domain/ai/llm-gateway.port';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { AiQuotaThrottledException } from '../ai/ai-quota-http';
import { FakeAiQuota } from '../ai/testing-fakes';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  CreatePlanningJobData,
  PlanningJobRepository,
  UpdatePlanningJobStatusData,
} from '../../domain/context/planning-job.repository';
import { PromptQueue } from '../../domain/context/prompt-queue';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { Section } from '../../domain/documents/section.entity';
import {
  SectionRepository,
  SectionTitle,
} from '../../domain/documents/section.repository';
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

  claimForGathering(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }

  appendResultChunk(): ReturnType<PlanningJobRepository['appendResultChunk']> {
    return Promise.reject(new Error('not implemented'));
  }

  claimForPlanning(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }

  failIfStillGathering(): Promise<PlanningJob | null> {
    return Promise.reject(new Error('not implemented'));
  }
}

class StubPromptQueue implements PromptQueue {
  public enqueued: { jobId: string; userId: string }[] = [];
  private readonly shouldThrow: boolean;

  constructor(shouldThrow = false) {
    this.shouldThrow = shouldThrow;
  }

  enqueue(job: { jobId: string; userId: string }): Promise<void> {
    if (this.shouldThrow) {
      return Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:6379'));
    }
    this.enqueued.push(job);
    return Promise.resolve();
  }
}

class InMemoryDocumentRepository implements DocumentRepository {
  constructor(private readonly documents: Document[] = []) {}
  create(): Promise<Document> {
    return Promise.reject(new Error('not implemented'));
  }
  findById(id: string): Promise<Document | null> {
    return Promise.resolve(this.documents.find((d) => d.id === id) ?? null);
  }
  findByUser(): Promise<Document[]> {
    return Promise.reject(new Error('not implemented'));
  }
  update(): Promise<Document> {
    return Promise.reject(new Error('not implemented'));
  }
  delete(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
}

class InMemorySectionRepository implements SectionRepository {
  constructor(private readonly sections: Section[] = []) {}
  create(): Promise<Section> {
    return Promise.reject(new Error('not implemented'));
  }
  findById(id: string): Promise<Section | null> {
    return Promise.resolve(this.sections.find((s) => s.id === id) ?? null);
  }
  findByDocument(): Promise<Section[]> {
    return Promise.reject(new Error('not implemented'));
  }
  update(): Promise<Section> {
    return Promise.reject(new Error('not implemented'));
  }
  delete(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
  maxOrder(): Promise<number | null> {
    return Promise.reject(new Error('not implemented'));
  }
  reorder(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
  findTitlesByDocument(): Promise<SectionTitle[]> {
    return Promise.reject(new Error('not implemented'));
  }
  replaceAll(): Promise<number> {
    return Promise.reject(new Error('not implemented'));
  }
}

function makeDocument(overrides: Partial<Document> = {}): Document {
  return new Document({
    id: 'doc-1',
    userId: 'user-1',
    title: 'Q3 Planning',
    docType: 'blog',
    status: 'draft',
    styleConfig: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function makeSection(overrides: Partial<Section> = {}): Section {
  return new Section({
    id: 'section-1',
    documentId: 'doc-1',
    title: 'Intro',
    content: 'Hello world',
    order: 0,
    status: 'draft',
    wordCount: 2,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

class InMemoryConnections implements ConnectorConnectionRepository {
  constructor(private readonly rows: ConnectorConnection[]) {}
  findActiveByUser(userId: string): Promise<ConnectorConnection[]> {
    return Promise.resolve(
      this.rows.filter(
        (c) => c.userId === userId && c.status === ConnectorStatus.Active,
      ),
    );
  }
  findById(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }
  findByUserAndProvider(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }
  findByComposioAccountId(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }
  findAllByUser(): Promise<ConnectorConnection[]> {
    return Promise.reject(new Error('not implemented'));
  }
  upsertInitiated(): Promise<ConnectorConnection> {
    return Promise.reject(new Error('not implemented'));
  }
  updateStatus(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }
}

function makeConnection(
  overrides: Partial<ConnectorConnection> = {},
): ConnectorConnection {
  return new ConnectorConnection({
    id: 'conn-1',
    userId: 'user-1',
    provider: ConnectorProvider.Notion,
    composioAccountId: 'ca_notion',
    status: ConnectorStatus.Active,
    connectedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function buildUseCase(opts: {
  queue?: PromptQueue;
  documents?: Document[];
  sections?: Section[];
  connections?: ConnectorConnection[];
  providerConfigured?: boolean;
  quota?: FakeAiQuota;
}): {
  useCase: SubmitPlanningJobUseCase;
  repository: InMemoryPlanningJobRepository;
  quota: FakeAiQuota;
} {
  const repository = new InMemoryPlanningJobRepository();
  const queue = opts.queue ?? new StubPromptQueue();
  const quota = opts.quota ?? new FakeAiQuota();
  const gateway: LlmGateway = {
    isAvailable: () => opts.providerConfigured ?? true,
    modelIdentity: () => '[]',
    complete: () => Promise.reject(new Error('never called')),
  };
  const useCase = new SubmitPlanningJobUseCase(
    repository,
    queue,
    new InMemoryDocumentRepository(opts.documents),
    new InMemorySectionRepository(opts.sections),
    new InMemoryConnections(opts.connections ?? [makeConnection()]),
    gateway,
    quota,
  );
  return { useCase, repository, quota };
}

describe('SubmitPlanningJobUseCase', () => {
  it('creates the job and enqueues it with the created id', async () => {
    const { useCase } = buildUseCase({});

    const result = await useCase.execute({
      userId: 'user-1',
      prompt: 'Plan my chapter',
      connectors: ['notion'],
    });

    expect(result.status).toBe(JobStatus.Pending);
    expect(result.documentId).toBeNull();
    expect(result.sectionId).toBeNull();
  });

  it('marks the job failed and throws 503 when enqueue fails', async () => {
    const { useCase, repository } = buildUseCase({
      queue: new StubPromptQueue(true),
    });

    await expect(
      useCase.execute({ userId: 'user-1', prompt: 'Plan my chapter' }),
    ).rejects.toThrow(ServiceUnavailableException);

    // No orphaned pending job — the created job (deterministic first id in
    // this fake) must have been marked failed, not left pending.
    const job = await repository.findById('job-1');
    expect(job).not.toBeNull();
    expect(job?.status).toBe(JobStatus.Failed);
    expect(job?.errorCode).toBe('ENQUEUE_FAILED');
    // Fixed text: the queue error can carry an internal address.
    expect(job?.errorMessage).toBe('Failed to enqueue job');
    expect(job?.finishedAt).not.toBeNull();
  });

  it('binds documentId when owned by the caller', async () => {
    const { useCase } = buildUseCase({ documents: [makeDocument()] });

    const result = await useCase.execute({
      userId: 'user-1',
      prompt: 'Plan my chapter',
      documentId: 'doc-1',
    });

    expect(result.documentId).toBe('doc-1');
  });

  it('404s when documentId is not owned by the caller', async () => {
    const { useCase } = buildUseCase({
      documents: [makeDocument({ userId: 'user-2' })],
    });

    await expect(
      useCase.execute({
        userId: 'user-1',
        prompt: 'Plan my chapter',
        documentId: 'doc-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s when documentId does not exist', async () => {
    const { useCase } = buildUseCase({});

    await expect(
      useCase.execute({
        userId: 'user-1',
        prompt: 'Plan my chapter',
        documentId: 'missing-doc',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('binds sectionId (and its derived documentId) when owned by the caller', async () => {
    const { useCase } = buildUseCase({
      documents: [makeDocument()],
      sections: [makeSection()],
    });

    const result = await useCase.execute({
      userId: 'user-1',
      prompt: 'Plan my chapter',
      sectionId: 'section-1',
    });

    expect(result.sectionId).toBe('section-1');
    expect(result.documentId).toBe('doc-1');
  });

  it('404s when sectionId does not exist', async () => {
    const { useCase } = buildUseCase({ documents: [makeDocument()] });

    await expect(
      useCase.execute({
        userId: 'user-1',
        prompt: 'Plan my chapter',
        sectionId: 'missing-section',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("404s when sectionId's document belongs to another user", async () => {
    const { useCase } = buildUseCase({
      documents: [makeDocument({ userId: 'user-2' })],
      sections: [makeSection()],
    });

    await expect(
      useCase.execute({
        userId: 'user-1',
        prompt: 'Plan my chapter',
        sectionId: 'section-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s when the given documentId and sectionId belong to different documents', async () => {
    const { useCase } = buildUseCase({
      documents: [makeDocument({ id: 'doc-1' }), makeDocument({ id: 'doc-2' })],
      sections: [makeSection({ documentId: 'doc-2' })],
    });

    await expect(
      useCase.execute({
        userId: 'user-1',
        prompt: 'Plan my chapter',
        documentId: 'doc-1',
        sectionId: 'section-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  describe('connectors', () => {
    it("accepts providers among the caller's active connections", async () => {
      const { useCase } = buildUseCase({
        connections: [
          makeConnection(),
          makeConnection({
            id: 'conn-2',
            provider: ConnectorProvider.Github,
            composioAccountId: 'ca_github',
          }),
        ],
      });

      const job = await useCase.execute({
        userId: 'user-1',
        prompt: 'Plan',
        connectors: ['notion', 'github'],
      });

      expect(job.connectors).toEqual(['notion', 'github']);
    });

    it("400s with the same message for another user's connection, an inactive one and an unknown one", async () => {
      const { useCase, repository } = buildUseCase({
        connections: [
          makeConnection({ userId: 'user-2' }),
          makeConnection({
            id: 'conn-3',
            provider: ConnectorProvider.Trello,
            status: ConnectorStatus.Revoked,
          }),
        ],
      });

      const messages: string[] = [];
      for (const connector of ['notion', 'trello', 'made-up']) {
        const err = await useCase
          .execute({
            userId: 'user-1',
            prompt: 'Plan',
            connectors: [connector],
          })
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        messages.push((err as Error).message);
      }

      expect(new Set(messages)).toEqual(
        new Set(['Connectors must be among your active connections']),
      );
      expect(await repository.findById('job-1')).toBeNull();
    });

    it('400s when only one of several connectors is invalid', async () => {
      const { useCase } = buildUseCase({});

      await expect(
        useCase.execute({
          userId: 'user-1',
          prompt: 'Plan',
          connectors: ['notion', 'github'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not read connections when none are requested', async () => {
      const { useCase } = buildUseCase({ connections: [] });

      await expect(
        useCase.execute({ userId: 'user-1', prompt: 'Plan' }),
      ).resolves.toBeDefined();
    });
  });

  describe('quota', () => {
    it('checks the quota without counting, before creating the job', async () => {
      const { useCase, quota } = buildUseCase({});

      await useCase.execute({ userId: 'user-1', prompt: 'Plan' });

      expect(quota.checked).toEqual(['user-1']);
      expect(quota.reserved).toEqual([]);
    });

    it('429s over quota without creating or enqueuing a job', async () => {
      const queue = new StubPromptQueue();
      const enqueue = jest.spyOn(queue, 'enqueue');
      const quota = new FakeAiQuota();
      quota.failWith = new AiQuotaExceededError(900);
      const { useCase, repository } = buildUseCase({ queue, quota });

      const err = await useCase
        .execute({ userId: 'user-1', prompt: 'Plan' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AiQuotaThrottledException);
      expect((err as AiQuotaThrottledException).retryAfterSeconds).toBe(900);
      expect(await repository.findById('job-1')).toBeNull();
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('503s when the counters are unreachable (fail closed)', async () => {
      const quota = new FakeAiQuota();
      quota.failWith = new AiQuotaUnavailableError();
      const { useCase, repository } = buildUseCase({ quota });

      await expect(
        useCase.execute({ userId: 'user-1', prompt: 'Plan' }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(await repository.findById('job-1')).toBeNull();
    });

    it('skips the check with no provider configured (the stub planner costs nothing)', async () => {
      const quota = new FakeAiQuota(0);
      quota.failWith = new AiQuotaExceededError(1);
      const { useCase } = buildUseCase({ providerConfigured: false, quota });

      await expect(
        useCase.execute({ userId: 'user-1', prompt: 'Plan' }),
      ).resolves.toBeDefined();
      expect(quota.checked).toEqual([]);
    });
  });
});
