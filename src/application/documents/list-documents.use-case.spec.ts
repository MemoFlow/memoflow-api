import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { ListDocumentsUseCase } from './list-documents.use-case';

class InMemoryDocumentRepository implements DocumentRepository {
  constructor(private readonly documents: Document[] = []) {}

  create(): Promise<Document> {
    return Promise.reject(new Error('not implemented'));
  }

  findById(): Promise<Document | null> {
    return Promise.reject(new Error('not implemented'));
  }

  findByUser(userId: string): Promise<Document[]> {
    return Promise.resolve(this.documents.filter((d) => d.userId === userId));
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

describe('ListDocumentsUseCase', () => {
  it('only returns documents owned by the requesting user', async () => {
    const mine = makeDocument({ id: 'doc-1', userId: 'user-1' });
    const someoneElses = makeDocument({ id: 'doc-2', userId: 'user-2' });
    const useCase = new ListDocumentsUseCase(
      new InMemoryDocumentRepository([mine, someoneElses]),
    );

    const result = await useCase.execute('user-1');

    expect(result).toEqual([mine]);
  });
});
