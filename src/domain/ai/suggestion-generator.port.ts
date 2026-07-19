/**
 * Port abstracting the AI call behind a suggestion. Domain imports nothing
 * external — the only layer allowed to import `@anthropic-ai/sdk` is
 * infrastructure (`AnthropicSuggestionGenerator`).
 */
export const SUGGESTION_GENERATOR = Symbol('SuggestionGenerator');

export interface GenerateSuggestionInput {
  /** Fully rendered prompt template (`{{content}}` already substituted). */
  promptTemplate: string;
  originalText: string;
  featureType: string;
}

export interface GenerateSuggestionOutput {
  suggestedText: string;
}

export interface SuggestionGenerator {
  /**
   * Whether this generator can actually produce a suggestion right now
   * (e.g. `ANTHROPIC_API_KEY` is configured). Checked by
   * `GenerateSuggestionUseCase` up front so a missing API key is reported as
   * "AI not configured" without a wasted round trip through `generate`.
   */
  isAvailable(): boolean;

  /**
   * Throws `SuggestionGeneration*`/`SuggestionGeneratorUnavailableError`
   * (see `suggestion-generation.errors.ts`) on failure — never a raw SDK
   * error.
   */
  generate(input: GenerateSuggestionInput): Promise<GenerateSuggestionOutput>;
}
