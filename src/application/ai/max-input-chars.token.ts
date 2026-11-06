/**
 * DI token for the resolved `AI_MAX_INPUT_CHARS` value (a plain number).
 * `AiModule` and `ContextModule` each read it once from `ConfigService`;
 * use-cases take it as an optional constructor argument so domain and helper
 * code never read env themselves.
 */
export const AI_MAX_INPUT_CHARS = Symbol('AiMaxInputChars');

/** Mirrors the `AI_MAX_INPUT_CHARS` default in `env.validation.ts`. */
export const DEFAULT_AI_MAX_INPUT_CHARS = 40_000;
