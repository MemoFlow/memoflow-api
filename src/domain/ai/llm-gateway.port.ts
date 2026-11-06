/**
 * Port for every LLM call in the API. One adapter (OpenRouter) implements it
 * in infrastructure; role-specific ports (`SuggestionGenerator`, `LlmPlanner`)
 * are built on top. Domain imports nothing from other layers.
 *
 * Failures throw the typed errors from `suggestion-generation.errors.ts`
 * (their messages are safe to surface to clients; provider detail goes to
 * logs only).
 */
export const LLM_GATEWAY = Symbol('LlmGateway');

export interface LlmJsonSchema {
  /** Schema name sent to the provider (letters, digits, `_`, `-`). */
  name: string;
  /** JSON Schema the reply must satisfy. */
  schema: Record<string, unknown>;
}

export interface LlmCompletionRequest {
  system: string;
  user: string;
  jsonSchema: LlmJsonSchema;
  /** Overrides the configured default output token cap. */
  maxTokens?: number;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmCompletion {
  /** Parsed JSON reply. Shape is NOT validated here; callers validate. */
  json: unknown;
  /** Model that actually served the call (the router may pick another). */
  model: string;
  finishReason: string;
  usage?: LlmUsage;
}

export interface LlmGateway {
  /** Whether a provider key is configured. */
  isAvailable(): boolean;
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
}
