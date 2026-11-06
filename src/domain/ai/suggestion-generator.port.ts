/**
 * Port abstracting the AI call behind a suggestion. Domain imports nothing
 * external; the implementation (`GatewaySuggestionGenerator`) lives in
 * infrastructure on top of the `LlmGateway` port.
 */
export const SUGGESTION_GENERATOR = Symbol('SuggestionGenerator');

export interface GenerateSuggestionInput {
  /** Fully rendered system message. */
  system: string;
  /** Fully rendered user message. */
  user: string;
  featureType: string;
  /** The user the call is made for; its provider attempts count against them. */
  userId: string;
}

export interface GenerateSuggestionOutput {
  suggestedText: string;
  /** Model that actually served the call, when known. */
  model: string | null;
}

export interface SuggestionGenerator {
  /**
   * Whether this generator can actually produce a suggestion right now
   * (e.g. `OPENROUTER_API_KEY` is configured). Checked by
   * `GenerateSuggestionUseCase` up front so a missing API key is reported as
   * "AI not configured" without a wasted round trip through `generate`.
   */
  isAvailable(): boolean;

  /**
   * Identity of the configured model, fallbacks included, so cached output is
   * never reused across a model change.
   */
  cacheScope(): string;

  /**
   * Throws `SuggestionGeneration*`/`SuggestionGeneratorUnavailableError`
   * (see `suggestion-generation.errors.ts`) on failure — never a raw provider
   * error.
   */
  generate(input: GenerateSuggestionInput): Promise<GenerateSuggestionOutput>;
}
