import { Inject, Injectable } from '@nestjs/common';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { GetSectionUseCase } from './get-section.use-case';

export interface DeleteSectionInput {
  userId: string;
  documentId: string;
  sectionId: string;
}

@Injectable()
export class DeleteSectionUseCase {
  constructor(
    private readonly getSectionUseCase: GetSectionUseCase,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
  ) {}

  async execute(input: DeleteSectionInput): Promise<void> {
    await this.getSectionUseCase.execute({
      userId: input.userId,
      documentId: input.documentId,
      sectionId: input.sectionId,
    });
    await this.sectionRepository.delete(input.sectionId);
  }
}
