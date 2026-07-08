import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Section } from '../../domain/documents/section.entity';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { GetDocumentUseCase } from './get-document.use-case';

export interface GetSectionInput {
  userId: string;
  documentId: string;
  sectionId: string;
}

/**
 * Reads a section, scoped to the owning document/user. A missing section, a
 * section belonging to a different document, and a document owned by
 * someone else all 404 — never leaking existence. Reused by the
 * update/delete section use-cases for the same checks.
 */
@Injectable()
export class GetSectionUseCase {
  constructor(
    private readonly getDocumentUseCase: GetDocumentUseCase,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
  ) {}

  async execute(input: GetSectionInput): Promise<Section> {
    await this.getDocumentUseCase.execute({
      userId: input.userId,
      documentId: input.documentId,
    });

    const section = await this.sectionRepository.findById(input.sectionId);
    if (!section || section.documentId !== input.documentId) {
      throw new NotFoundException(`Section ${input.sectionId} not found`);
    }
    return section;
  }
}
