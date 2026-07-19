import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentVersionMetadata } from '../../domain/document-versions/document-version.entity';
import { DOCUMENT_VERSION_REPOSITORY } from '../../domain/document-versions/document-version.repository';
import type { DocumentVersionRepository } from '../../domain/document-versions/document-version.repository';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';

export interface ListVersionsInput {
  userId: string;
  documentId: string;
}

/**
 * Lists a document's version metadata (no `sectionsSnapshot` payload),
 * newest first.
 */
@Injectable()
export class ListVersionsUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
    @Inject(DOCUMENT_VERSION_REPOSITORY)
    private readonly documentVersionRepository: DocumentVersionRepository,
  ) {}

  async execute(input: ListVersionsInput): Promise<DocumentVersionMetadata[]> {
    const document = await this.documentRepository.findById(input.documentId);
    if (!document || document.userId !== input.userId) {
      throw new NotFoundException(`Document ${input.documentId} not found`);
    }
    return this.documentVersionRepository.findByDocumentId(input.documentId);
  }
}
