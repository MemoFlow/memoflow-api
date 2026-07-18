import { Inject, Injectable } from '@nestjs/common';
import { Document } from '../../domain/documents/document.entity';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
import { GetDocumentUseCase } from './get-document.use-case';

export interface UpdateDocumentInput {
  userId: string;
  documentId: string;
  patch: {
    title?: string;
    docType?: string;
    status?: string;
    styleConfig?: Record<string, unknown>;
  };
}

@Injectable()
export class UpdateDocumentUseCase {
  constructor(
    private readonly getDocumentUseCase: GetDocumentUseCase,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
  ) {}

  async execute(input: UpdateDocumentInput): Promise<Document> {
    await this.getDocumentUseCase.execute({
      userId: input.userId,
      documentId: input.documentId,
    });
    return this.documentRepository.update(input.documentId, input.patch);
  }
}
