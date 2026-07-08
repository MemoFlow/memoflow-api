import { Inject, Injectable } from '@nestjs/common';
import { Section } from '../../domain/documents/section.entity';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { GetSectionUseCase } from './get-section.use-case';
import { wordCount } from './word-count';

export interface UpdateSectionInput {
  userId: string;
  documentId: string;
  sectionId: string;
  patch: {
    title?: string;
    content?: string;
    status?: string;
  };
}

/**
 * `order` is deliberately absent from the patch shape — a section's
 * position only ever changes via `ReorderSectionsUseCase`, never here.
 */
@Injectable()
export class UpdateSectionUseCase {
  constructor(
    private readonly getSectionUseCase: GetSectionUseCase,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
  ) {}

  async execute(input: UpdateSectionInput): Promise<Section> {
    await this.getSectionUseCase.execute({
      userId: input.userId,
      documentId: input.documentId,
      sectionId: input.sectionId,
    });

    const { content, ...rest } = input.patch;
    const patch =
      content !== undefined
        ? { ...rest, content, wordCount: wordCount(content) }
        : rest;

    return this.sectionRepository.update(input.sectionId, patch);
  }
}
