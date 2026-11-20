/**
 * Typed quota failures with FIXED messages. Safe to surface to clients and to
 * record on a failed planning job; no counter values or keys ever appear.
 */

/** Which cap blocked the call; the user cap wins when both are spent. */
export type AiQuotaScope = 'user' | 'global';

/** Codes a client can switch on (HTTP `error`, planning job `error_code`). */
export const AI_QUOTA_EXCEEDED_CODE = 'AI_QUOTA_EXCEEDED';
export const AI_GLOBAL_QUOTA_EXCEEDED_CODE = 'AI_GLOBAL_QUOTA_EXCEEDED';

export function aiQuotaCode(scope: AiQuotaScope): string {
  return scope === 'user'
    ? AI_QUOTA_EXCEEDED_CODE
    : AI_GLOBAL_QUOTA_EXCEEDED_CODE;
}

/** "45 min", "2 h", "2 h 5 min"; rounded up to whole minutes, at least 1 min. */
export function formatResetDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.ceil(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** Fixed templates: only the limit and the time to reset are interpolated. */
export function aiQuotaMessage(
  scope: AiQuotaScope,
  limit: number,
  retryAfterSeconds: number,
): string {
  const reset = `resets at 00:00 UTC (in ${formatResetDuration(retryAfterSeconds)})`;
  return scope === 'user'
    ? `You've used all ${limit} AI requests for today. Your quota ${reset}.`
    : `MemoFlow's AI capacity for today has been reached. It ${reset}.`;
}

export const AI_QUOTA_UNAVAILABLE_MESSAGE =
  'AI usage limits are temporarily unavailable';

/** A daily cap (per user or global) is spent. */
export class AiQuotaExceededError extends Error {
  readonly scope: AiQuotaScope;
  /** The cap that was hit (the user's limit or the global one). */
  readonly limit: number;
  readonly retryAfterSeconds: number;
  /** Next UTC midnight, when the counters restart. */
  readonly resetsAt: Date;

  constructor(
    scope: AiQuotaScope,
    limit: number,
    retryAfterSeconds: number,
    now: Date = new Date(),
  ) {
    super(aiQuotaMessage(scope, limit, retryAfterSeconds));
    this.name = 'AiQuotaExceededError';
    this.scope = scope;
    this.limit = limit;
    this.retryAfterSeconds = retryAfterSeconds;
    this.resetsAt = new Date(now.getTime() + retryAfterSeconds * 1000);
  }

  get code(): string {
    return aiQuotaCode(this.scope);
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
