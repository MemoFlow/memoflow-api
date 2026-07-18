import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Document } from '../../domain/documents/document.entity';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';

export interface GetDocumentInput {
  userId: string;
  documentId: string;
}

/**
 * Reads a document, scoped to its owner. A missing document and a document
 * owned by someone else both 404 — never leaking whether another user's
 * document id exists. Reused by the update/delete use-cases for the same
 * ownership check.
 */
@Injectable()
export class GetDocumentUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
  ) {}

  async execute(input: GetDocumentInput): Promise<Document> {
    const document = await this.documentRepository.findById(input.documentId);
    if (!document || document.userId !== input.userId) {
      throw new NotFoundException(`Document ${input.documentId} not found`);
    }
    return document;
  }
}
