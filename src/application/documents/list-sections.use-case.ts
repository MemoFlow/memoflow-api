import { Inject, Injectable } from '@nestjs/common';
import { Section } from '../../domain/documents/section.entity';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { GetDocumentUseCase } from './get-document.use-case';

export interface ListSectionsInput {
  userId: string;
  documentId: string;
}

@Injectable()
export class ListSectionsUseCase {
  constructor(
    private readonly getDocumentUseCase: GetDocumentUseCase,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
  ) {}

  async execute(input: ListSectionsInput): Promise<Section[]> {
    await this.getDocumentUseCase.execute({
      userId: input.userId,
      documentId: input.documentId,
    });
    return this.sectionRepository.findByDocument(input.documentId);
  }
}
