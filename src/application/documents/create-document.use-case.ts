import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Document } from '../../domain/documents/document.entity';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
import { STORAGE_LIMITS } from '../../domain/limits/storage-limits';
import type { StorageLimits } from '../../domain/limits/storage-limits';
import { conflictOnLimit } from '../shared/limit-conflict';
import {
  DOCUMENT_CREATED_EVENT,
  DocumentCreatedEventPayload,
} from '../../domain/documents/document-events';

export interface CreateDocumentInput {
  userId: string;
  title: string;
  docType: string;
  status?: string;
  styleConfig?: Record<string, unknown>;
}

@Injectable()
export class CreateDocumentUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
    private readonly eventEmitter: EventEmitter2,
    @Inject(STORAGE_LIMITS) private readonly limits: StorageLimits,
  ) {}

  async execute(input: CreateDocumentInput): Promise<Document> {
    // The cap is enforced inside the repository (user-row lock + count +
    // insert in one transaction); over it, 409 and nothing is pruned.
    const document = await conflictOnLimit(() =>
      this.documentRepository.create(
        {
          userId: input.userId,
          title: input.title,
          docType: input.docType,
          status: input.status ?? 'draft',
          styleConfig: input.styleConfig ?? {},
        },
        { maxPerUser: this.limits.maxDocumentsPerUser },
      ),
    );

    // Emitted only after the write commits — a gamification consumer must
    // never see a `document.created` event for a document that doesn't
    // actually exist yet.
    const payload: DocumentCreatedEventPayload = {
      userId: document.userId,
      documentId: document.id,
    };
    this.eventEmitter.emit(DOCUMENT_CREATED_EVENT, payload);

    return document;
  }
}
