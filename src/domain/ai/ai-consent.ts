/**
 * AI consent contracts. Free models may log prompts or use them for
 * training, so AI use needs recorded consent to a specific notice version.
 */

/**
 * Version of the AI data-use notice. Consent counts only while the stored
 * version equals this value, so changing the notice (and this constant)
 * requires everyone to accept again.
 */
export const AI_NOTICE_VERSION = '2026-11-06';

/** `error` value of the 403 returned when AI consent is missing or stale. */
export const AI_CONSENT_REQUIRED_CODE = 'AI_CONSENT_REQUIRED';

/** Fixed message of the 403 and of a job failed for lack of consent. */
export const AI_CONSENT_REQUIRED_MESSAGE =
  'AI consent is required. Accept the current AI notice to use AI features.';

/** Fixed message of the 409 for accepting a notice version that isn't current. */
export const AI_CONSENT_VERSION_MISMATCH_MESSAGE =
  'The AI notice version is not current. Reload the notice and accept again.';

export const AI_CONSENT_ACCEPTED_EVENT = 'ai.consent_accepted';
export const AI_CONSENT_WITHDRAWN_EVENT = 'ai.consent_withdrawn';

export interface AiConsentAcceptedEventPayload {
  userId: string;
  version: string;
}

export interface AiConsentWithdrawnEventPayload {
  userId: string;
}
