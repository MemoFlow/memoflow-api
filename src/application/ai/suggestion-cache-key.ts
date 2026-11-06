import { createHash } from 'node:crypto';

/** Bump to invalidate every entry if the key's meaning ever changes. */
const KEY_VERSION = 1;

export interface SuggestionCacheKeyInput {
  userId: string;
  featureType: string;
  promptVersion: string;
  /** `SuggestionGenerator.cacheScope()`: model and fallbacks. */
  modelScope: string;
  /** The section text exactly as prepared for the model. */
  content: string;
  /** The light context exactly as prepared for the model. */
  context: string;
}

/**
 * SHA-256 over a JSON array of everything the output depends on, so no field
 * can run into the next ("ab" + "c" differs from "a" + "bc"). The user id is
 * part of it: two users never share an entry, even for identical text. The
 * per-request nonce is not, as it changes every time. The key reveals none of
 * its inputs.
 */
export function suggestionCacheKey(input: SuggestionCacheKeyInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        KEY_VERSION,
        input.userId,
        input.featureType,
        input.promptVersion,
        input.modelScope,
        input.content,
        input.context,
      ]),
    )
    .digest('hex');
}
