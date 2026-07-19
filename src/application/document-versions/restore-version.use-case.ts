import { Inject, Injectable } from '@nestjs/common';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { GetVersionUseCase } from './get-version.use-case';

export interface RestoreVersionInput {
  userId: string;
  documentId: string;
  versionId: string;
}

export interface RestoreVersionResult {
  documentId: string;
  versionId: string;
  version: number;
  sectionsRestored: number;
}

/**
 * Restores a document's CURRENT sections to a previously saved snapshot.
 * Ownership + belongs-to-document checks are delegated to
 * `GetVersionUseCase`; the actual replacement happens atomically in a
 * single PostgreSQL transaction via `SectionRepository.replaceAll` (delete
 * existing sections, reinsert from the snapshot with its stored
 * order/status/wordCount).
 *
 * Restoring does NOT write to Mongo — versions are immutable and restoring
 * doesn't create a new one.
 */
@Injectable()
export class RestoreVersionUseCase {
  constructor(
    private readonly getVersionUseCase: GetVersionUseCase,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
  ) {}

  async execute(input: RestoreVersionInput): Promise<RestoreVersionResult> {
    const version = await this.getVersionUseCase.execute(input);

    const sectionsRestored = await this.sectionRepository.replaceAll(
      input.documentId,
      version.sectionsSnapshot.map((section) => ({
        title: section.title,
        content: section.content,
        order: section.order,
        status: section.status,
        wordCount: section.wordCount,
      })),
    );

    return {
      documentId: input.documentId,
      versionId: version.id,
      version: version.version,
      sectionsRestored,
    };
  }
}
