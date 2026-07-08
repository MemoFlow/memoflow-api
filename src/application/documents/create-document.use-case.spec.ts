import { randomUUID } from 'node:crypto';
import { Document } from '../../domain/documents/document.entity';
import {
  CreateDocumentData,
  DocumentRepository,
} from '../../domain/documents/document.repository';
import { CreateDocumentUseCase } from './create-document.use-case';

class InMemoryDocumentRepository implements DocumentRepository {
  private readonly documents: Document[] = [];

  create(data: CreateDocumentData): Promise<Document> {
    const document = new Document({
      id: randomUUID(),
      userId: data.userId,
      title: data.title,
      docType: data.docType,
      status: data.status,
      styleConfig: data.styleConfig,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.documents.push(document);
    return Promise.resolve(document);
  }

  findById(id: string): Promise<Document | null> {
    return Promise.resolve(this.documents.find((d) => d.id === id) ?? null);
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

describe('CreateDocumentUseCase', () => {
  it('creates a document defaulting status to draft and styleConfig to {}', async () => {
    const repository = new InMemoryDocumentRepository();
    const useCase = new CreateDocumentUseCase(repository);

    const document = await useCase.execute({
      userId: 'user-1',
      title: 'Q3 Planning',
      docType: 'planning',
    });

    expect(document.title).toBe('Q3 Planning');
    expect(document.docType).toBe('planning');
    expect(document.status).toBe('draft');
    expect(document.styleConfig).toEqual({});
    expect(document.userId).toBe('user-1');
  });

  it('honors an explicit status and styleConfig when provided', async () => {
    const repository = new InMemoryDocumentRepository();
    const useCase = new CreateDocumentUseCase(repository);

    const document = await useCase.execute({
      userId: 'user-1',
      title: 'Q3 Planning',
      docType: 'planning',
      status: 'published',
      styleConfig: { theme: 'dark' },
    });

    expect(document.status).toBe('published');
    expect(document.styleConfig).toEqual({ theme: 'dark' });
  });
});
