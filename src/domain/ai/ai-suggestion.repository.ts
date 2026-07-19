import { AiSuggestion, SuggestionStatus } from './ai-suggestion.entity';

export const AI_SUGGESTION_REPOSITORY = Symbol('AiSuggestionRepository');

export interface CreateAiSuggestionData {
  sectionId: string;
  userId: string;
  featureType: string;
  originalText: string;
  suggestedText: string;
  promptVersion: string;
}

export interface AiSuggestionRepository {
  create(data: CreateAiSuggestionData): Promise<AiSuggestion>;
  findById(id: string): Promise<AiSuggestion | null>;
  /** Ordered newest first. */
  findBySectionId(sectionId: string): Promise<AiSuggestion[]>;
  /**
   * Atomically transitions a suggestion from `pending` to `status` (a
   * conditional `UPDATE ... WHERE id = $1 AND status = 'pending'`), returning
   * the updated suggestion only if the transition succeeded. Returns `null`
   * when the suggestion is missing OR no longer `pending` (already
   * reviewed) — mirrors `PlanningJobRepository.claimForProcessing`'s
   * check-then-write-race-safe shape. The use-case has already 404'd a
   * missing suggestion via a pre-read, so it treats `null` here as "already
   * reviewed" (409).
   */
  markReviewed(
    id: string,
    status: SuggestionStatus,
  ): Promise<AiSuggestion | null>;
}
