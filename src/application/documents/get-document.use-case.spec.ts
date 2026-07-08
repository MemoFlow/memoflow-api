import { NotFoundException } from '@nestjs/common';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { GetDocumentUseCase } from './get-document.use-case';

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

describe('GetDocumentUseCase', () => {
  it('returns the document when the requesting user owns it', async () => {
    const document = makeDocument();
    const useCase = new GetDocumentUseCase(
      new InMemoryDocumentRepository([document]),
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
    });

    expect(result).toBe(document);
  });

  it('throws NotFoundException when the document does not exist', async () => {
    const useCase = new GetDocumentUseCase(new InMemoryDocumentRepository([]));

    await expect(
      useCase.execute({ userId: 'user-1', documentId: 'missing' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException (not Forbidden) when a different user requests the document', async () => {
    const document = makeDocument({ userId: 'user-1' });
    const useCase = new GetDocumentUseCase(
      new InMemoryDocumentRepository([document]),
    );

    await expect(
      useCase.execute({ userId: 'user-2', documentId: 'doc-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
