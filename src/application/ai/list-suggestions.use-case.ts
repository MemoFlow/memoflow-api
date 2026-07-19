import { Inject, Injectable } from '@nestjs/common';
import { AiSuggestion } from '../../domain/ai/ai-suggestion.entity';
import { AI_SUGGESTION_REPOSITORY } from '../../domain/ai/ai-suggestion.repository';
import type { AiSuggestionRepository } from '../../domain/ai/ai-suggestion.repository';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { assertSectionOwnedByUser } from './section-access';

export interface ListSuggestionsInput {
  userId: string;
  sectionId: string;
}

@Injectable()
export class ListSuggestionsUseCase {
  constructor(
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
    @Inject(AI_SUGGESTION_REPOSITORY)
    private readonly aiSuggestionRepository: AiSuggestionRepository,
  ) {}

  async execute(input: ListSuggestionsInput): Promise<AiSuggestion[]> {
    await assertSectionOwnedByUser(
      this.sectionRepository,
      this.documentRepository,
      input.userId,
      input.sectionId,
    );

    return this.aiSuggestionRepository.findBySectionId(input.sectionId);
  }
}
