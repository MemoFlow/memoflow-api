import { NotFoundException } from '@nestjs/common';
import {
  DocumentVersion,
  DocumentVersionMetadata,
} from '../../domain/document-versions/document-version.entity';
import { DocumentVersionRepository } from '../../domain/document-versions/document-version.repository';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { GetVersionUseCase } from './get-version.use-case';

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
  constructor(private readonly versions: DocumentVersion[] = []) {}

  create(): Promise<DocumentVersion> {
    return Promise.reject(new Error('not implemented'));
  }

  findById(id: string): Promise<DocumentVersion | null> {
    return Promise.resolve(this.versions.find((v) => v.id === id) ?? null);
  }

  findByDocumentId(): Promise<DocumentVersionMetadata[]> {
    return Promise.reject(new Error('not implemented'));
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

function makeVersion(
  overrides: Partial<DocumentVersion> = {},
): DocumentVersion {
  return new DocumentVersion({
    id: 'version-1',
    documentId: 'doc-1',
    userId: 'user-1',
    version: 1,
    label: null,
    sectionsSnapshot: [
      {
        title: 'Intro',
        content: 'Hello',
        order: 0,
        status: 'draft',
        wordCount: 1,
      },
    ],
    savedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('GetVersionUseCase', () => {
  it('returns the full snapshot when the requesting user owns the document', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const documentVersionRepository = new InMemoryDocumentVersionRepository([
      makeVersion(),
    ]);
    const useCase = new GetVersionUseCase(
      documentRepository,
      documentVersionRepository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      versionId: 'version-1',
    });

    expect(result.id).toBe('version-1');
    expect(result.sectionsSnapshot).toHaveLength(1);
  });

  it('throws NotFoundException when the document does not exist', async () => {
    const useCase = new GetVersionUseCase(
      new InMemoryDocumentRepository([]),
      new InMemoryDocumentVersionRepository([]),
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        documentId: 'missing',
        versionId: 'version-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when a different user requests the version', async () => {
    const documentRepository = new InMemoryDocumentRepository([
      makeDocument({ userId: 'user-1' }),
    ]);
    const documentVersionRepository = new InMemoryDocumentVersionRepository([
      makeVersion(),
    ]);
    const useCase = new GetVersionUseCase(
      documentRepository,
      documentVersionRepository,
    );

    await expect(
      useCase.execute({
        userId: 'user-2',
        documentId: 'doc-1',
        versionId: 'version-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the version does not exist', async () => {
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const useCase = new GetVersionUseCase(
      documentRepository,
      new InMemoryDocumentVersionRepository([]),
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        documentId: 'doc-1',
        versionId: 'missing',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the version belongs to a different document', async () => {
    const documentRepository = new InMemoryDocumentRepository([
      makeDocument({ id: 'doc-1' }),
      makeDocument({ id: 'doc-2' }),
    ]);
    const documentVersionRepository = new InMemoryDocumentVersionRepository([
      makeVersion({ id: 'version-1', documentId: 'doc-2' }),
    ]);
    const useCase = new GetVersionUseCase(
      documentRepository,
      documentVersionRepository,
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        documentId: 'doc-1',
        versionId: 'version-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
