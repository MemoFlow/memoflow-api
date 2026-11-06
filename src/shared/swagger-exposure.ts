/**
 * Tiers on which Swagger UI and the OpenAPI JSON are served. An explicit
 * allowlist rather than "not production", so staging and any unknown or
 * future tier default to off.
 */
export const SWAGGER_ENABLED_ENVS: readonly string[] = ['development', 'test'];

export function isSwaggerEnabled(nodeEnv: string | undefined): boolean {
  return nodeEnv !== undefined && SWAGGER_ENABLED_ENVS.includes(nodeEnv);
}
