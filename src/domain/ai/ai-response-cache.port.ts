/**
 * Short-lived cache of validated suggestion output, so repeating the same
 * request does not spend provider quota. Fails open: an error behaves as a
 * miss. Domain imports nothing from other layers.
 */
export const AI_RESPONSE_CACHE = Symbol('AiResponseCache');

export interface CachedSuggestion {
  suggestedText: string;
  model: string | null;
}

export interface AiResponseCache {
  /** The entry for `key`, or `null` on a miss, a malformed entry or any error. */
  get(key: string): Promise<CachedSuggestion | null>;

  /** Stores `value` for the configured TTL. Never throws. */
  set(key: string, value: CachedSuggestion): Promise<void>;
}
