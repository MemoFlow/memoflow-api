/**
 * Typed domain errors for `SuggestionGenerator.generate`. Plain TypeScript —
 * no SDK imports. Infrastructure implementations (`OpenRouterGateway`,
 * `NullSuggestionGenerator`) throw these; the application layer
 * (`GenerateSuggestionUseCase`) maps them to HTTP responses.
 */

/**
 * Default message of `SuggestionGeneratorUnavailableError`; the use-case
 * treats it as "not configured" and any other message as an outage.
 */
export const SUGGESTION_GENERATOR_NOT_CONFIGURED_MESSAGE =
  'AI suggestion generation is not configured';

/**
 * Generator unavailable. Default message = no provider configured (e.g.
 * `OPENROUTER_API_KEY` unset); a custom fixed message = provider outage
 * (timeout, network failure, 408, 5xx). Maps to 503.
 */
export class SuggestionGeneratorUnavailableError extends Error {
  constructor(message = SUGGESTION_GENERATOR_NOT_CONFIGURED_MESSAGE) {
    super(message);
    this.name = 'SuggestionGeneratorUnavailableError';
  }
}

/** Model refused to answer (`finish_reason: 'content_filter'`) — maps to 422. */
export class SuggestionGenerationRefusedError extends Error {
  constructor(message = 'The model refused to generate a suggestion') {
    super(message);
    this.name = 'SuggestionGenerationRefusedError';
  }
}

/** Response cut off before completion (`finish_reason: 'length'`) — maps to 502. */
export class SuggestionGenerationTruncatedError extends Error {
  constructor(message = 'The model response was truncated before completion') {
    super(message);
    this.name = 'SuggestionGenerationTruncatedError';
  }
}

/** Provider rate limit hit — maps to 503 with a retry hint. */
export class SuggestionGeneratorRateLimitedError extends Error {
  readonly retryAfterSeconds?: number;

  constructor(
    message = 'The AI provider is rate-limited',
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'SuggestionGeneratorRateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Catch-all for provider-side failures that aren't one of the above (malformed
 * response body, 401/403/other 4xx, unhandled finish reasons) — maps to 502.
 * 5xx and timeouts are `SuggestionGeneratorUnavailableError` (503).
 */
export class SuggestionGenerationProviderError extends Error {
  constructor(message = 'The AI provider failed to generate a suggestion') {
    super(message);
    this.name = 'SuggestionGenerationProviderError';
  }
}
