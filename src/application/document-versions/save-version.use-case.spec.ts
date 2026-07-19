import { NotFoundException } from '@nestjs/common';
import {
  DocumentVersion,
  DocumentVersionMetadata,
  SectionSnapshot,
} from '../../domain/document-versions/document-version.entity';
import {
  CreateDocumentVersionData,
  DocumentVersionRepository,
} from '../../domain/document-versions/document-version.repository';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { Section } from '../../domain/documents/section.entity';
import { SectionRepository } from '../../domain/documents/section.repository';
import { SaveVersionUseCase } from './save-version.use-case';

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

  reorder(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  replaceAll(): Promise<number> {
    return Promise.reject(new Error('not implemented'));
  }
}

class InMemoryDocumentVersionRepository implements DocumentVersionRepository {
  public createCalls: CreateDocumentVersionData[] = [];
  private versions: DocumentVersion[] = [];

  create(data: CreateDocumentVersionData): Promise<DocumentVersion> {
    this.createCalls.push(data);
    const existing = this.versions.filter(
      (v) => v.documentId === data.documentId,
    );
    const version = new DocumentVersion({
      id: `version-${this.versions.length + 1}`,
      documentId: data.documentId,
      userId: data.userId,
      version: existing.length + 1,
      label: data.label ?? null,
      sectionsSnapshot: data.sectionsSnapshot,
      savedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    this.versions.push(version);
    return Promise.resolve(version);
  }

  findById(id: string): Promise<DocumentVersion | null> {
    return Promise.resolve(this.versions.find((v) => v.id === id) ?? null);
  }

  findByDocumentId(): Promise<DocumentVersionMetadata[]> {
    return Promise.reject(new Error('not implemented'));
  }

  maxVersion(documentId: string): Promise<number | null> {
    const existing = this.versions.filter((v) => v.documentId === documentId);
    return Promise.resolve(
      existing.length ? Math.max(...existing.map((v) => v.version)) : null,
    );
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

describe('SaveVersionUseCase', () => {
  it('snapshots the current sections and creates a version', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([
      makeSection({ id: 's-1', order: 0, title: 'Intro' }),
      makeSection({ id: 's-2', order: 1, title: 'Body' }),
    ]);
    const documentVersionRepository = new InMemoryDocumentVersionRepository();
    const useCase = new SaveVersionUseCase(
      documentRepository,
      sectionRepository,
      documentVersionRepository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      label: 'Before rewrite',
    });

    expect(documentVersionRepository.createCalls).toHaveLength(1);
    const call = documentVersionRepository.createCalls[0];
    expect(call.documentId).toBe('doc-1');
    expect(call.userId).toBe('user-1');
    expect(call.label).toBe('Before rewrite');
    expect(call.sectionsSnapshot).toEqual<SectionSnapshot[]>([
      {
        title: 'Intro',
        content: 'Hello world',
        order: 0,
        status: 'draft',
        wordCount: 2,
      },
      {
        title: 'Body',
        content: 'Hello world',
        order: 1,
        status: 'draft',
        wordCount: 2,
      },
    ]);
    expect(result.version).toBe(1);
  });

  it('creates a valid version with an empty snapshot when the document has no sections', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([]);
    const documentVersionRepository = new InMemoryDocumentVersionRepository();
    const useCase = new SaveVersionUseCase(
      documentRepository,
      sectionRepository,
      documentVersionRepository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
    });

    expect(documentVersionRepository.createCalls[0].sectionsSnapshot).toEqual(
      [],
    );
    expect(result.sectionsSnapshot).toEqual([]);
    expect(result.label).toBeNull();
  });

  it('increments the version number across successive saves for the same document', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const sectionRepository = new InMemorySectionRepository([]);
    const documentVersionRepository = new InMemoryDocumentVersionRepository();
    const useCase = new SaveVersionUseCase(
      documentRepository,
      sectionRepository,
      documentVersionRepository,
    );

    const first = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
    });
    const second = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
  });

  it('throws NotFoundException when the document does not exist', async () => {
    const useCase = new SaveVersionUseCase(
      new InMemoryDocumentRepository([]),
      new InMemorySectionRepository([]),
      new InMemoryDocumentVersionRepository(),
    );

    await expect(
      useCase.execute({ userId: 'user-1', documentId: 'missing' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException (not Forbidden) when a different user requests the save', async () => {
    const documentRepository = new InMemoryDocumentRepository([
      makeDocument({ userId: 'user-1' }),
    ]);
    const useCase = new SaveVersionUseCase(
      documentRepository,
      new InMemorySectionRepository([]),
      new InMemoryDocumentVersionRepository(),
    );

    await expect(
      useCase.execute({ userId: 'user-2', documentId: 'doc-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
