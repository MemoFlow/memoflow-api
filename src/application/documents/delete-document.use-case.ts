import { Inject, Injectable } from '@nestjs/common';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
import { GetDocumentUseCase } from './get-document.use-case';

export interface DeleteDocumentInput {
  userId: string;
  documentId: string;
}

/**
 * Deletes a document. Sections cascade via the `sections.document_id`
 * FK's `ON DELETE CASCADE` — see the `CreateDocumentsAndSections` migration.
 */
@Injectable()
export class DeleteDocumentUseCase {
  constructor(
    private readonly getDocumentUseCase: GetDocumentUseCase,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
  ) {}

  async execute(input: DeleteDocumentInput): Promise<void> {
    await this.getDocumentUseCase.execute({
      userId: input.userId,
      documentId: input.documentId,
    });
    await this.documentRepository.delete(input.documentId);
  }
}
