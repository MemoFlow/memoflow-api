/**
 * Pure logic for scripts/ai-smoke.ts (the live AI smoke run). No I/O here so
 * it can be unit tested; the script owns every network and Redis call.
 */

export type StepStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface StepResult {
  name: string;
  status: StepStatus;
}

/** Final counts and the process exit code (0 only if nothing failed). */
export function summarizeSteps(results: StepResult[]): {
  pass: number;
  fail: number;
  skip: number;
  exitCode: number;
  line: string;
} {
  const count = (s: StepStatus) => results.filter((r) => r.status === s).length;
  const pass = count('PASS');
  const fail = count('FAIL');
  const skip = count('SKIP');
  return {
    pass,
    fail,
    skip,
    exitCode: fail > 0 ? 1 : 0,
    line: `Summary: ${pass} passed, ${fail} failed, ${skip} skipped`,
  };
}

const NON_PRODUCTION_LABEL =
  /(^|[.-])(localhost|local|dev|development|staging|stage|stg|test)([.-]|$)/i;

/**
 * Production guard. A host is allowed only if it is loopback or has a clearly
 * non-production label (dev, staging, test, ...), and never if it contains
 * "prod". Anything ambiguous is refused; --allow-production overrides it.
 */
export function isLikelyProduction(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.includes('prod')) return true;
  if (host === '127.0.0.1' || host === '[::1]' || host === '::1') return false;
  return !NON_PRODUCTION_LABEL.test(host);
}

export interface OpenRouterModel {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  supported_parameters?: unknown;
}

function isFree(model: OpenRouterModel): boolean {
  const id = typeof model.id === 'string' ? model.id : '';
  const p = model.pricing;
  return (
    id.endsWith(':free') ||
    (Number(p?.prompt) === 0 &&
      Number(p?.completion) === 0 &&
      p?.prompt !== undefined &&
      p?.completion !== undefined)
  );
}

/** Free models that advertise structured output support. */
export function findStructuredFreeModels(
  models: OpenRouterModel[],
  limit = 5,
): { count: number; ids: string[] } {
  const matching = models.filter((m) => {
    if (typeof m.id !== 'string' || !isFree(m)) return false;
    const params = Array.isArray(m.supported_parameters)
      ? m.supported_parameters
      : [];
    return (
      params.includes('response_format') ||
      params.includes('structured_outputs')
    );
  });
  return {
    count: matching.length,
    ids: matching.slice(0, limit).map((m) => m.id as string),
  };
}

const CITATION_ID = /^S\d+$/;

/** Source ids in a planning result that are not `S` plus a number. */
export function invalidCitationIds(sourceIds: string[]): string[] {
  return sourceIds.filter((id) => !CITATION_ID.test(id));
}

export interface PlanningResultSummary {
  suggestionCount: number;
  sourceIds: string[];
  invalidSourceIds: string[];
  retrieval: Record<string, number>;
  /** `retrieval.failed`; null when absent or not a boolean. */
  retrievalFailed: boolean | null;
}

/** Counts and ids only; never any generated text. */
export function summarizePlanningJob(job: {
  result?: Record<string, unknown> | null;
  context_used?: Record<string, unknown> | null;
}): PlanningResultSummary {
  const result = job.result ?? {};
  const suggestions = Array.isArray(result.suggestions)
    ? result.suggestions
    : [];
  const sources = Array.isArray(result.sources) ? result.sources : [];
  const sourceIds = sources.map((s) =>
    typeof s === 'object' &&
    s !== null &&
    typeof (s as { id?: unknown }).id === 'string'
      ? (s as { id: string }).id
      : '<missing>',
  );
  const retrievalRaw = job.context_used?.retrieval;
  const retrieval: Record<string, number> = {};
  if (typeof retrievalRaw === 'object' && retrievalRaw !== null) {
    for (const key of ['matched', 'used', 'dropped', 'truncated']) {
      const v = (retrievalRaw as Record<string, unknown>)[key];
      if (typeof v === 'number') retrieval[key] = v;
    }
  }
  const failedRaw =
    typeof retrievalRaw === 'object' && retrievalRaw !== null
      ? (retrievalRaw as Record<string, unknown>).failed
      : undefined;
  return {
    suggestionCount: suggestions.length,
    sourceIds,
    invalidSourceIds: invalidCitationIds(sourceIds),
    retrieval,
    retrievalFailed: typeof failedRaw === 'boolean' ? failedRaw : null,
  };
}

/** True when both counters rose between two readings. */
export function countersRose(
  before: { user: number; global: number },
  after: { user: number; global: number },
): boolean {
  return after.user > before.user && after.global > before.global;
}

/**
 * Problems that make a completed planning job a false pass. The smoke section
 * is built to match the prompt, so retrieval must have worked and found it,
 * and a null model means the stub planner ran, not the real one.
 */
export function planningJobProblems(
  summary: PlanningResultSummary,
  model: string | null,
): string[] {
  const problems: string[] = [];
  if (model === null) problems.push('model is null (stub planner ran)');
  if (summary.retrievalFailed !== false) {
    problems.push(
      summary.retrievalFailed === true
        ? 'retrieval.failed is true'
        : 'retrieval.failed is missing',
    );
  }
  if (!summary.retrieval.matched)
    problems.push('retrieval.matched is 0 or missing');
  if (!summary.retrieval.used) problems.push('retrieval.used is 0 or missing');
  return problems;
}

/**
 * Plain http would send the password and token in clear text. Allowed only
 * for loopback; anything else needs --allow-insecure-http.
 */
export function isInsecureRemoteHttp(url: {
  protocol: string;
  hostname: string;
}): boolean {
  if (url.protocol !== 'http:') return false;
  return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(
    url.hostname.toLowerCase(),
  );
}

/** Which 403 this is, from the response body fields only. */
export function classifyForbidden(
  body: Record<string, unknown> | null,
): 'consent' | 'email' | 'other' {
  if (body?.error === 'AI_CONSENT_REQUIRED') return 'consent';
  if (body?.message === 'Email not verified') return 'email';
  return 'other';
}
