import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { SECTION_CREATED_EVENT } from '../../domain/documents/document-events';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { Section } from '../../domain/documents/section.entity';
import {
  CreateSectionData,
  CreateSectionOptions,
  SectionRepository,
  SectionTitle,
} from '../../domain/documents/section.repository';
import { LimitReachedError } from '../../domain/limits/storage-limits';
import { DEFAULT_STORAGE_LIMITS } from '../../domain/limits/storage-limits';
import { CreateSectionUseCase } from './create-section.use-case';
import { GetDocumentUseCase } from './get-document.use-case';

function makeEventEmitter(): jest.Mocked<Pick<EventEmitter2, 'emit'>> {
  return { emit: jest.fn() };
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
  private readonly sections: Section[] = [];

  create(
    data: CreateSectionData,
    options: CreateSectionOptions,
  ): Promise<Section> {
    if (
      this.sections.filter((s) => s.documentId === data.documentId).length >=
      options.maxPerDocument
    ) {
      return Promise.reject(
        new LimitReachedError('section', options.maxPerDocument),
      );
    }
    const section = new Section({
      id: randomUUID(),
      documentId: data.documentId,
      title: data.title,
      content: data.content,
      order: data.order,
      status: data.status,
      wordCount: data.wordCount,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.sections.push(section);
    return Promise.resolve(section);
  }

  findById(id: string): Promise<Section | null> {
    return Promise.resolve(this.sections.find((s) => s.id === id) ?? null);
  }

  findByDocument(documentId: string): Promise<Section[]> {
    return Promise.resolve(
      this.sections
        .filter((s) => s.documentId === documentId)
        .sort((a, b) => a.order - b.order),
    );
  }

  update(): Promise<Section> {
    return Promise.reject(new Error('not implemented'));
  }

  delete(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  maxOrder(documentId: string): Promise<number | null> {
    const rows = this.sections.filter((s) => s.documentId === documentId);
    if (rows.length === 0) return Promise.resolve(null);
    return Promise.resolve(Math.max(...rows.map((s) => s.order)));
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
    docType: 'planning',
    status: 'draft',
    styleConfig: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('CreateSectionUseCase', () => {
  it('computes wordCount from content server-side', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository();
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
      DEFAULT_STORAGE_LIMITS,
    );

    const section = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      title: 'Intro',
      content: 'four little words here',
    });

    expect(section.wordCount).toBe(4);
  });

  it('treats empty content as zero words', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository();
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
      DEFAULT_STORAGE_LIMITS,
    );

    const section = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      title: 'Intro',
      content: '   ',
    });

    expect(section.wordCount).toBe(0);
  });

  it('appends after the last section when order is omitted', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository();
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
      DEFAULT_STORAGE_LIMITS,
    );

    const first = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      title: 'First',
      content: 'a',
    });
    const second = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      title: 'Second',
      content: 'b',
    });

    expect(first.order).toBe(0);
    expect(second.order).toBe(1);
  });

  it('always appends regardless of any pre-existing sections (order is not client-settable)', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository();
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
      DEFAULT_STORAGE_LIMITS,
    );

    await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      title: 'First',
      content: 'a',
    });
    const section = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      title: 'Second',
      content: 'b',
    });

    // `CreateSectionInput` has no `order` field at all — position only ever
    // changes afterwards via `ReorderSectionsUseCase`.
    expect(section.order).toBe(1);
  });

  it('throws NotFoundException when the document is not owned by the requesting user', async () => {
    const documentRepository = new InMemoryDocumentRepository([
      makeDocument({ userId: 'user-1' }),
    ]);
    const sectionRepository = new InMemorySectionRepository();
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
      DEFAULT_STORAGE_LIMITS,
    );

    await expect(
      useCase.execute({
        userId: 'user-2',
        documentId: 'doc-1',
        title: 'Intro',
        content: 'a',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('emits section.created after the section is persisted', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository();
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
      DEFAULT_STORAGE_LIMITS,
    );

    const section = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      title: 'Intro',
      content: 'four little words here',
    });

    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(SECTION_CREATED_EVENT, {
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: section.id,
    });
  });

  it('answers 409 once the document holds the maximum number of sections', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository();
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
      { ...DEFAULT_STORAGE_LIMITS, maxSectionsPerDocument: 2 },
    );
    const input = {
      userId: 'user-1',
      documentId: 'doc-1',
      title: 'S',
      content: 'x',
    };
    await useCase.execute(input);
    await useCase.execute(input);
    eventEmitter.emit.mockClear();

    const err: unknown = await useCase.execute(input).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(
      'Section limit reached (2)',
    );
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(await sectionRepository.findByDocument('doc-1')).toHaveLength(2);
  });
});
