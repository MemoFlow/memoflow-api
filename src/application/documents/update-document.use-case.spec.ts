import { NotFoundException } from '@nestjs/common';
import { Document } from '../../domain/documents/document.entity';
import {
  DocumentRepository,
  UpdateDocumentData,
} from '../../domain/documents/document.repository';
import { GetDocumentUseCase } from './get-document.use-case';
import { UpdateDocumentUseCase } from './update-document.use-case';

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

  update(id: string, patch: UpdateDocumentData): Promise<Document> {
    const document = this.documents.find((d) => d.id === id);
    if (!document) return Promise.reject(new Error('not found'));
    Object.assign(document, patch);
    return Promise.resolve(document);
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

describe('UpdateDocumentUseCase', () => {
  it('updates the document when owned by the requesting user', async () => {
    const document = makeDocument();
    const repository = new InMemoryDocumentRepository([document]);
    const useCase = new UpdateDocumentUseCase(
      new GetDocumentUseCase(repository),
      repository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      documentId: 'doc-1',
      patch: { title: 'New Title' },
    });

    expect(result.title).toBe('New Title');
  });

  it('throws NotFoundException instead of updating when the document belongs to a different user', async () => {
    const document = makeDocument({ userId: 'user-1' });
    const repository = new InMemoryDocumentRepository([document]);
    const useCase = new UpdateDocumentUseCase(
      new GetDocumentUseCase(repository),
      repository,
    );

    await expect(
      useCase.execute({
        userId: 'user-2',
        documentId: 'doc-1',
        patch: { title: 'Hijacked' },
      }),
    ).rejects.toThrow(NotFoundException);
    expect(document.title).toBe('Q3 Planning');
  });
});
