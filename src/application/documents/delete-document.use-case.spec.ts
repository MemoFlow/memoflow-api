import { NotFoundException } from '@nestjs/common';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { DeleteDocumentUseCase } from './delete-document.use-case';
import { GetDocumentUseCase } from './get-document.use-case';

class InMemoryDocumentRepository implements DocumentRepository {
  public deletedIds: string[] = [];

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

  delete(id: string): Promise<void> {
    this.deletedIds.push(id);
    return Promise.resolve();
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

describe('DeleteDocumentUseCase', () => {
  it('deletes the document when owned by the requesting user', async () => {
    const document = makeDocument();
    const repository = new InMemoryDocumentRepository([document]);
    const useCase = new DeleteDocumentUseCase(
      new GetDocumentUseCase(repository),
      repository,
    );

    await useCase.execute({ userId: 'user-1', documentId: 'doc-1' });

    expect(repository.deletedIds).toEqual(['doc-1']);
  });

  it('throws NotFoundException instead of deleting when owned by a different user', async () => {
    const document = makeDocument({ userId: 'user-1' });
    const repository = new InMemoryDocumentRepository([document]);
    const useCase = new DeleteDocumentUseCase(
      new GetDocumentUseCase(repository),
      repository,
    );

    await expect(
      useCase.execute({ userId: 'user-2', documentId: 'doc-1' }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.deletedIds).toEqual([]);
  });
});
