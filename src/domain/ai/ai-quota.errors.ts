/**
 * Typed quota failures with FIXED messages. Safe to surface to clients and to
 * record on a failed planning job; no counter values or keys ever appear.
 */

export const AI_QUOTA_EXCEEDED_MESSAGE =
  'Daily AI usage limit reached. Try again later.';
export const AI_QUOTA_UNAVAILABLE_MESSAGE =
  'AI usage limits are temporarily unavailable';

/** A daily cap (per user or global) is spent. */
export class AiQuotaExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(AI_QUOTA_EXCEEDED_MESSAGE);
    this.name = 'AiQuotaExceededError';
  }
}

/**
 * The counters could not be read or updated. The quota fails closed: with no
 * way to count, no provider call is allowed.
 */
export class AiQuotaUnavailableError extends Error {
  constructor() {
    super(AI_QUOTA_UNAVAILABLE_MESSAGE);
    this.name = 'AiQuotaUnavailableError';
  }
}
