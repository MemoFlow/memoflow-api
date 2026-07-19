import { NotFoundException } from '@nestjs/common';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { Section } from '../../domain/documents/section.entity';
import { SectionRepository } from '../../domain/documents/section.repository';
import { GetDocumentUseCase } from './get-document.use-case';
import { GetSectionUseCase } from './get-section.use-case';

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

describe('GetSectionUseCase', () => {
  it('returns the section when the document is owned and the section belongs to it', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([makeSection()]);
    const useCase = new GetSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: 'section-1',
    });

    expect(result.id).toBe('section-1');
  });

  it('throws NotFoundException when the document belongs to another user', async () => {
    const documentRepository = new InMemoryDocumentRepository([
      makeDocument({ userId: 'user-1' }),
    ]);
    const sectionRepository = new InMemorySectionRepository([makeSection()]);
    const useCase = new GetSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
    );

    await expect(
      useCase.execute({
        userId: 'user-2',
        documentId: 'doc-1',
        sectionId: 'section-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the section belongs to a different document', async () => {
    const documentRepository = new InMemoryDocumentRepository([
      makeDocument({ id: 'doc-1' }),
      makeDocument({ id: 'doc-2' }),
    ]);
    const sectionRepository = new InMemorySectionRepository([
      makeSection({ id: 'section-1', documentId: 'doc-2' }),
    ]);
    const useCase = new GetSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        documentId: 'doc-1',
        sectionId: 'section-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the section does not exist', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([]);
    const useCase = new GetSectionUseCase(
      new GetDocumentUseCase(documentRepository),
      sectionRepository,
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        documentId: 'doc-1',
        sectionId: 'missing',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
