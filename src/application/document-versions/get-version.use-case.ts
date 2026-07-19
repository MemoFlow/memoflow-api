import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentVersion } from '../../domain/document-versions/document-version.entity';
import { DOCUMENT_VERSION_REPOSITORY } from '../../domain/document-versions/document-version.repository';
import type { DocumentVersionRepository } from '../../domain/document-versions/document-version.repository';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';

export interface GetVersionInput {
  userId: string;
  documentId: string;
  versionId: string;
}

/**
 * Reads a single version's full snapshot, scoped to the owning
 * document/user. A missing version, a version belonging to a different
 * document, and a document owned by someone else all 404 — never leaking
 * existence. Reused by `RestoreVersionUseCase` for the same checks.
 */
@Injectable()
export class GetVersionUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
    @Inject(DOCUMENT_VERSION_REPOSITORY)
    private readonly documentVersionRepository: DocumentVersionRepository,
  ) {}

  async execute(input: GetVersionInput): Promise<DocumentVersion> {
    const document = await this.documentRepository.findById(input.documentId);
    if (!document || document.userId !== input.userId) {
      throw new NotFoundException(`Document ${input.documentId} not found`);
    }

    const version = await this.documentVersionRepository.findById(
      input.versionId,
    );
    if (!version || version.documentId !== input.documentId) {
      throw new NotFoundException(`Version ${input.versionId} not found`);
    }
    return version;
  }
}
