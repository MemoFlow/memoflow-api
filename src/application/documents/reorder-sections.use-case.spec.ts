import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { Section } from '../../domain/documents/section.entity';
import { SectionRepository } from '../../domain/documents/section.repository';
import { GetDocumentUseCase } from './get-document.use-case';
import { ReorderSectionsUseCase } from './reorder-sections.use-case';

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
  public reorderCalls: { documentId: string; orderedIds: string[] }[] = [];

  constructor(private sections: Section[] = []) {}

  create(): Promise<Section> {
    return Promise.reject(new Error('not implemented'));
  }

  findById(): Promise<Section | null> {
    return Promise.reject(new Error('not implemented'));
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

  maxOrder(): Promise<number | null> {
    return Promise.reject(new Error('not implemented'));
  }

  reorder(documentId: string, orderedIds: string[]): Promise<void> {
    this.reorderCalls.push({ documentId, orderedIds });
    this.sections = this.sections.map((s) => {
      const index = orderedIds.indexOf(s.id);
      return index === -1 ? s : new Section({ ...s, order: index });
    });
    return Promise.resolve();
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

describe('ReorderSectionsUseCase', () => {
  it('reorders sections to match the given id order', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([
      makeSection({ id: 'section-1', order: 0 }),
      makeSection({ id: 'section-2', order: 1 }),
      makeSection({ id: 'section-3', order: 2 }),
    ]);
    const useCase = new ReorderSectionsUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      sectionIds: ['section-3', 'section-1', 'section-2'],
    });

    expect(sectionRepository.reorderCalls).toEqual([
      {
        documentId: 'doc-1',
        orderedIds: ['section-3', 'section-1', 'section-2'],
      },
    ]);
    expect(result.map((s) => s.id)).toEqual([
      'section-3',
      'section-1',
      'section-2',
    ]);
  });

  it('rejects with BadRequestException when sectionIds is missing an existing section', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([
      makeSection({ id: 'section-1', order: 0 }),
      makeSection({ id: 'section-2', order: 1 }),
    ]);
    const useCase = new ReorderSectionsUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        documentId: 'doc-1',
        sectionIds: ['section-1'],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(sectionRepository.reorderCalls).toEqual([]);
  });

  it('rejects with BadRequestException when sectionIds contains an id from another document', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([
      makeSection({ id: 'section-1', order: 0 }),
      makeSection({ id: 'section-2', order: 1 }),
    ]);
    const useCase = new ReorderSectionsUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        documentId: 'doc-1',
        sectionIds: ['section-1', 'not-a-real-section'],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(sectionRepository.reorderCalls).toEqual([]);
  });

  it('throws NotFoundException when the document is not owned by the requesting user', async () => {
    const documentRepository = new InMemoryDocumentRepository([
      makeDocument({ userId: 'user-1' }),
    ]);
    const sectionRepository = new InMemorySectionRepository([
      makeSection({ id: 'section-1', order: 0 }),
    ]);
    const useCase = new ReorderSectionsUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
    );

    await expect(
      useCase.execute({
        userId: 'user-2',
        documentId: 'doc-1',
        sectionIds: ['section-1'],
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
