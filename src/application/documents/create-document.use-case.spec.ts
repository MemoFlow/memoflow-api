import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { DOCUMENT_CREATED_EVENT } from '../../domain/documents/document-events';
import { Document } from '../../domain/documents/document.entity';
import {
  CreateDocumentData,
  CreateDocumentOptions,
  DocumentRepository,
} from '../../domain/documents/document.repository';
import { LimitReachedError } from '../../domain/limits/storage-limits';
import { DEFAULT_STORAGE_LIMITS } from '../../domain/limits/storage-limits';
import { CreateDocumentUseCase } from './create-document.use-case';

class InMemoryDocumentRepository implements DocumentRepository {
  private readonly documents: Document[] = [];

  create(
    data: CreateDocumentData,
    options: CreateDocumentOptions,
  ): Promise<Document> {
    if (
      this.documents.filter((d) => d.userId === data.userId).length >=
      options.maxPerUser
    ) {
      return Promise.reject(
        new LimitReachedError('document', options.maxPerUser),
      );
    }
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

function makeEventEmitter(): jest.Mocked<Pick<EventEmitter2, 'emit'>> {
  return { emit: jest.fn() };
}

describe('CreateDocumentUseCase', () => {
  it('creates a document defaulting status to draft and styleConfig to {}', async () => {
    const repository = new InMemoryDocumentRepository();
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateDocumentUseCase(
      repository,
      eventEmitter as unknown as EventEmitter2,
      DEFAULT_STORAGE_LIMITS,
    );

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
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateDocumentUseCase(
      repository,
      eventEmitter as unknown as EventEmitter2,
      DEFAULT_STORAGE_LIMITS,
    );

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

  it('emits document.created after the document is persisted', async () => {
    const repository = new InMemoryDocumentRepository();
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateDocumentUseCase(
      repository,
      eventEmitter as unknown as EventEmitter2,
      DEFAULT_STORAGE_LIMITS,
    );

    const document = await useCase.execute({
      userId: 'user-1',
      title: 'Q3 Planning',
      docType: 'planning',
    });

    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(DOCUMENT_CREATED_EVENT, {
      userId: 'user-1',
      documentId: document.id,
    });
  });

  it('answers 409 once the user holds the maximum number of documents', async () => {
    const repository = new InMemoryDocumentRepository();
    const useCase = new CreateDocumentUseCase(
      repository,
      makeEventEmitter() as unknown as EventEmitter2,
      { ...DEFAULT_STORAGE_LIMITS, maxDocumentsPerUser: 2 },
    );
    const input = { userId: 'user-1', title: 'Doc', docType: 'blog' };
    await useCase.execute(input);
    await useCase.execute(input);

    const err: unknown = await useCase.execute(input).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(
      'Document limit reached (2)',
    );
    // Another user is unaffected, and no event fires for the rejected create.
    await expect(
      useCase.execute({ ...input, userId: 'user-2' }),
    ).resolves.toBeDefined();
  });

  it('does not emit document.created when the cap rejects the create', async () => {
    const eventEmitter = makeEventEmitter();
    const useCase = new CreateDocumentUseCase(
      new InMemoryDocumentRepository(),
      eventEmitter as unknown as EventEmitter2,
      { ...DEFAULT_STORAGE_LIMITS, maxDocumentsPerUser: 0 },
    );

    await expect(
      useCase.execute({ userId: 'u', title: 'T', docType: 'blog' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
