import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentVersion } from '../../domain/document-versions/document-version.entity';
import { DOCUMENT_VERSION_REPOSITORY } from '../../domain/document-versions/document-version.repository';
import type { DocumentVersionRepository } from '../../domain/document-versions/document-version.repository';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';

export interface SaveVersionInput {
  userId: string;
  documentId: string;
  label?: string | null;
}

/**
 * Snapshots a document's current sections into a new immutable
 * `document_versions` entry (Mongo). Cross-DB write: validates the
 * referenced PG document is owned by the caller before touching Mongo at
 * all (per CLAUDE.md's cross-DB rule).
 */
@Injectable()
export class SaveVersionUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
    @Inject(DOCUMENT_VERSION_REPOSITORY)
    private readonly documentVersionRepository: DocumentVersionRepository,
  ) {}

  async execute(input: SaveVersionInput): Promise<DocumentVersion> {
    const document = await this.documentRepository.findById(input.documentId);
    if (!document || document.userId !== input.userId) {
      throw new NotFoundException(`Document ${input.documentId} not found`);
    }

    // An empty document (no sections yet) still gets a valid version with
    // an empty snapshot — versioning shouldn't require content to exist.
    const sections = await this.sectionRepository.findByDocument(
      input.documentId,
    );

    return this.documentVersionRepository.create({
      documentId: input.documentId,
      userId: input.userId,
      label: input.label ?? null,
      sectionsSnapshot: sections.map((section) => ({
        title: section.title,
        content: section.content,
        order: section.order,
        status: section.status,
        wordCount: section.wordCount,
      })),
    });
  }
}
