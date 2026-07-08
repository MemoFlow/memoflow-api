import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Section } from '../../domain/documents/section.entity';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { GetDocumentUseCase } from './get-document.use-case';

export interface ReorderSectionsInput {
  userId: string;
  documentId: string;
  sectionIds: string[];
}

@Injectable()
export class ReorderSectionsUseCase {
  constructor(
    private readonly getDocumentUseCase: GetDocumentUseCase,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
  ) {}

  async execute(input: ReorderSectionsInput): Promise<Section[]> {
    await this.getDocumentUseCase.execute({
      userId: input.userId,
      documentId: input.documentId,
    });

    const sections = await this.sectionRepository.findByDocument(
      input.documentId,
    );

    const existingIds = new Set(sections.map((section) => section.id));
    const requestedIds = new Set(input.sectionIds);

    if (
      existingIds.size !== requestedIds.size ||
      input.sectionIds.length !== sections.length ||
      ![...existingIds].every((id) => requestedIds.has(id))
    ) {
      throw new BadRequestException(
        'sectionIds must be exactly the set of this document’s section ids',
      );
    }

    await this.sectionRepository.reorder(input.documentId, input.sectionIds);
    return this.sectionRepository.findByDocument(input.documentId);
  }
}
