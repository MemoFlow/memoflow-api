import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AiSuggestion,
  SuggestionStatus,
} from '../../domain/ai/ai-suggestion.entity';
import { AI_SUGGESTION_REPOSITORY } from '../../domain/ai/ai-suggestion.repository';
import type { AiSuggestionRepository } from '../../domain/ai/ai-suggestion.repository';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { assertSectionOwnedByUser } from './section-access';

export interface ReviewSuggestionInput {
  userId: string;
  suggestionId: string;
  status: SuggestionStatus.Accepted | SuggestionStatus.Rejected;
}

/**
 * Reviews (accepts/rejects) a suggestion. Only ever transitions out of
 * `pending` — reviewing an already-reviewed suggestion is a 409, not a
 * silent overwrite. Never touches the section's content.
 *
 * The 409 is enforced by `markReviewed`'s atomic conditional update
 * (`WHERE status = 'pending'`), not by the in-memory `status` check below —
 * that check is only a fast-path (skips a write for the common case), since
 * a plain check-then-write here would race two concurrent reviews of the
 * same suggestion.
 */
@Injectable()
export class ReviewSuggestionUseCase {
  constructor(
    @Inject(AI_SUGGESTION_REPOSITORY)
    private readonly aiSuggestionRepository: AiSuggestionRepository,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
  ) {}

  async execute(input: ReviewSuggestionInput): Promise<AiSuggestion> {
    const suggestion = await this.aiSuggestionRepository.findById(
      input.suggestionId,
    );
    if (!suggestion) {
      throw new NotFoundException(`Suggestion ${input.suggestionId} not found`);
    }

    // Ownership is derived transitively via the suggestion's section/document
    // chain — a suggestion belonging to someone else's section 404s the same
    // as the suggestions-list endpoint would.
    await assertSectionOwnedByUser(
      this.sectionRepository,
      this.documentRepository,
      input.userId,
      suggestion.sectionId,
    );

    // Fast-path only — see the class doc comment. Skips the write for the
    // common case, but is not itself the source of truth for the 409.
    if (suggestion.status !== SuggestionStatus.Pending) {
      throw new ConflictException(
        `Suggestion ${input.suggestionId} has already been reviewed`,
      );
    }

    const reviewed = await this.aiSuggestionRepository.markReviewed(
      input.suggestionId,
      input.status,
    );
    if (!reviewed) {
      // The atomic conditional update lost: another request reviewed this
      // suggestion between our pre-read and this write.
      throw new ConflictException(
        `Suggestion ${input.suggestionId} has already been reviewed`,
      );
    }
    return reviewed;
  }
}
