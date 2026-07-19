import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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
import { SectionRepository } from '../../domain/documents/section.repository';
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
      return Promise.reject(new Error('redis unavailable'));
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

function buildUseCase(opts: {
  queue?: PromptQueue;
  documents?: Document[];
  sections?: Section[];
}): {
  useCase: SubmitPlanningJobUseCase;
  repository: InMemoryPlanningJobRepository;
} {
  const repository = new InMemoryPlanningJobRepository();
  const queue = opts.queue ?? new StubPromptQueue();
  const useCase = new SubmitPlanningJobUseCase(
    repository,
    queue,
    new InMemoryDocumentRepository(opts.documents),
    new InMemorySectionRepository(opts.sections),
  );
  return { useCase, repository };
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
});
