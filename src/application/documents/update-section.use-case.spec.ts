import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SECTION_UPDATED_EVENT } from '../../domain/documents/document-events';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { Section } from '../../domain/documents/section.entity';
import {
  SectionRepository,
  UpdateSectionData,
} from '../../domain/documents/section.repository';
import { GetDocumentUseCase } from './get-document.use-case';
import { GetSectionUseCase } from './get-section.use-case';
import { UpdateSectionUseCase } from './update-section.use-case';

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

  update(id: string, patch: UpdateSectionData): Promise<Section> {
    const section = this.sections.find((s) => s.id === id);
    if (!section) return Promise.reject(new Error('not found'));
    Object.assign(section, patch);
    return Promise.resolve(section);
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
    docType: 'planning',
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
    content: 'hello world',
    order: 0,
    status: 'draft',
    wordCount: 2,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('UpdateSectionUseCase', () => {
  it('recomputes wordCount when content changes', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([makeSection()]);
    const eventEmitter = makeEventEmitter();
    const useCase = new UpdateSectionUseCase(
      new GetSectionUseCase(
        new GetDocumentUseCase(documentRepository),
        sectionRepository,
      ),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: 'section-1',
      patch: { content: 'one two three four five' },
    });

    expect(result.wordCount).toBe(5);
    expect(result.content).toBe('one two three four five');
  });

  it('leaves wordCount untouched when content is not part of the patch', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([makeSection()]);
    const eventEmitter = makeEventEmitter();
    const useCase = new UpdateSectionUseCase(
      new GetSectionUseCase(
        new GetDocumentUseCase(documentRepository),
        sectionRepository,
      ),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: 'section-1',
      patch: { title: 'Renamed' },
    });

    expect(result.title).toBe('Renamed');
    expect(result.wordCount).toBe(2);
  });

  it('throws NotFoundException instead of updating when the document is owned by another user', async () => {
    const documentRepository = new InMemoryDocumentRepository([
      makeDocument({ userId: 'user-1' }),
    ]);
    const sectionRepository = new InMemorySectionRepository([makeSection()]);
    const eventEmitter = makeEventEmitter();
    const useCase = new UpdateSectionUseCase(
      new GetSectionUseCase(
        new GetDocumentUseCase(documentRepository),
        sectionRepository,
      ),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
    );

    await expect(
      useCase.execute({
        userId: 'user-2',
        documentId: 'doc-1',
        sectionId: 'section-1',
        patch: { title: 'Hijacked' },
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('emits section.updated with the recomputed wordCount after persisting', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([makeSection()]);
    const eventEmitter = makeEventEmitter();
    const useCase = new UpdateSectionUseCase(
      new GetSectionUseCase(
        new GetDocumentUseCase(documentRepository),
        sectionRepository,
      ),
      sectionRepository,
      eventEmitter as unknown as EventEmitter2,
    );

    await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: 'section-1',
      patch: { content: 'one two three four five' },
    });

    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(SECTION_UPDATED_EVENT, {
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: 'section-1',
      wordCount: 5,
    });
  });
});
