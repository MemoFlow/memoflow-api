import { LeadScoreResult } from './lead-score';

export const LEAD_SCORE_REPOSITORY = Symbol('LeadScoreRepository');

export interface LeadScoreRepository {
  /** Keeps the stored row unless a newer `computed_at` is already there. */
  saveIfNewer(
    userId: string,
    result: LeadScoreResult,
    computedAt: Date,
  ): Promise<void>;
}
