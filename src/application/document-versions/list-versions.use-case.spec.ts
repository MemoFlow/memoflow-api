import { NotFoundException } from '@nestjs/common';
import {
  DocumentVersion,
  DocumentVersionMetadata,
} from '../../domain/document-versions/document-version.entity';
import { DocumentVersionRepository } from '../../domain/document-versions/document-version.repository';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { ListVersionsUseCase } from './list-versions.use-case';

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

class InMemoryDocumentVersionRepository implements DocumentVersionRepository {
  constructor(private readonly metadata: DocumentVersionMetadata[] = []) {}

  create(): Promise<DocumentVersion> {
    return Promise.reject(new Error('not implemented'));
  }

  findById(): Promise<DocumentVersion | null> {
    return Promise.reject(new Error('not implemented'));
  }

  findByDocumentId(documentId: string): Promise<DocumentVersionMetadata[]> {
    return Promise.resolve(
      this.metadata
        .filter((m) => m.documentId === documentId)
        .sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime()),
    );
  }

  maxVersion(): Promise<number | null> {
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

function makeMetadata(
  overrides: Partial<DocumentVersionMetadata> = {},
): DocumentVersionMetadata {
  return {
    id: 'version-1',
    documentId: 'doc-1',
    version: 1,
    label: null,
    savedAt: new Date('2026-01-01T00:00:00.000Z'),
    sectionCount: 2,
    ...overrides,
  };
}

describe('ListVersionsUseCase', () => {
  it("lists a document's version metadata, newest first, without a sections payload", async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const documentVersionRepository = new InMemoryDocumentVersionRepository([
      makeMetadata({
        id: 'v1',
        version: 1,
        savedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      makeMetadata({
        id: 'v2',
        version: 2,
        savedAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
    ]);
    const useCase = new ListVersionsUseCase(
      documentRepository,
      documentVersionRepository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
    });

    expect(result.map((v) => v.id)).toEqual(['v2', 'v1']);
    expect(result[0]).not.toHaveProperty('sectionsSnapshot');
  });

  it('throws NotFoundException when the document does not exist', async () => {
    const useCase = new ListVersionsUseCase(
      new InMemoryDocumentRepository([]),
      new InMemoryDocumentVersionRepository([]),
    );

    await expect(
      useCase.execute({ userId: 'user-1', documentId: 'missing' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when a different user requests the list', async () => {
    const documentRepository = new InMemoryDocumentRepository([
      makeDocument({ userId: 'user-1' }),
    ]);
    const useCase = new ListVersionsUseCase(
      documentRepository,
      new InMemoryDocumentVersionRepository([]),
    );

    await expect(
      useCase.execute({ userId: 'user-2', documentId: 'doc-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
