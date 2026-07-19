/**
 * DI token for the resolved `CONTEXT_GATHER_TIMEOUT_MS` value (a plain
 * number, not a port — there's no alternate implementation, just a
 * configured value `ContextModule` reads once from `ConfigService` and
 * `ProcessPlanningJobUseCase`/`GatherTimeoutProcessor` consume). Kept out of
 * the domain layer since it's pure configuration, not a domain concept.
 */
export const GATHER_TIMEOUT_MS = Symbol('GatherTimeoutMs');
