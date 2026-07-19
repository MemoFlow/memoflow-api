/**
 * Typed domain errors for `SuggestionGenerator.generate`. Plain TypeScript —
 * no SDK imports. Infrastructure implementations (`AnthropicSuggestionGenerator`,
 * `NullSuggestionGenerator`) throw these; the application layer
 * (`GenerateSuggestionUseCase`) maps them to HTTP responses.
 */

/** No provider configured (e.g. `ANTHROPIC_API_KEY` unset) — maps to 503. */
export class SuggestionGeneratorUnavailableError extends Error {
  constructor(message = 'AI suggestion generation is not configured') {
    super(message);
    this.name = 'SuggestionGeneratorUnavailableError';
  }
}

/** Model refused to answer (`stop_reason: 'refusal'`) — maps to 422. */
export class SuggestionGenerationRefusedError extends Error {
  constructor(message = 'The model refused to generate a suggestion') {
    super(message);
    this.name = 'SuggestionGenerationRefusedError';
  }
}

/** Response cut off before completion (`stop_reason: 'max_tokens'`) — maps to 502. */
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
 * Catch-all for provider-side failures that aren't one of the above (5xx,
 * malformed response body, connection errors, unhandled stop reasons) —
 * maps to 502.
 */
export class SuggestionGenerationProviderError extends Error {
  constructor(message = 'The AI provider failed to generate a suggestion') {
    super(message);
    this.name = 'SuggestionGenerationProviderError';
  }
}
