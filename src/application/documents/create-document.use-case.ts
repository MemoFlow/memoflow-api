import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Document } from '../../domain/documents/document.entity';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
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
  ) {}

  async execute(input: CreateDocumentInput): Promise<Document> {
    const document = await this.documentRepository.create({
      userId: input.userId,
      title: input.title,
      docType: input.docType,
      status: input.status ?? 'draft',
      styleConfig: input.styleConfig ?? {},
    });

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
