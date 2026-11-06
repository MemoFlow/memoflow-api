/**
 * Daily AI usage caps. Free models count failed attempts against their own
 * cap, so every provider attempt (retries and the repair retry included)
 * reserves one unit first. Domain imports nothing from other layers.
 */
export const AI_QUOTA = Symbol('AiQuota');

export interface AiQuota {
  /**
   * Counts one provider attempt against the user's and the global daily cap.
   * If either cap is spent nothing is counted. Throws `AiQuotaExceededError`
   * when a cap is spent and `AiQuotaUnavailableError` when the counters can't
   * be reached (fail closed).
   */
  reserve(userId: string): Promise<void>;

  /**
   * Same checks as `reserve` but counts nothing: an early answer for callers
   * that would otherwise queue work that is certain to be refused.
   */
  check(userId: string): Promise<void>;
}
