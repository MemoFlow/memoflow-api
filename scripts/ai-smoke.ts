/**
 * Live smoke test of the AI layer against a deployed API. Owner-run: it needs
 * a real OpenRouter key and a throwaway account. It cannot run in CI.
 *
 * Usage:
 *   API_BASE_URL=https://memoflow-api-dev.example.com \
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... OPENROUTER_API_KEY=... \
 *     npm run ai:smoke -- [--accept-notice] [--keep] [--allow-production] \
 *       [--allow-insecure-http]
 *
 * Env (all required, no defaults):
 *   API_BASE_URL, SMOKE_EMAIL, SMOKE_PASSWORD  the target and a throwaway user
 *   OPENROUTER_API_KEY  the gate. Without it the run prints SKIPPED and exits 2
 *                       (not 0, so a wrapper cannot take a skip for a pass). The key is
 *                       sent ONLY to openrouter.ai, to list models; the API
 *                       under test uses the key configured on its own service.
 * Env (optional, enables the quota counter checks; read-only, never writes):
 *   REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_TLS (true|1)
 *
 * Flags:
 *   --accept-notice     accept the AI notice for the account if consent is
 *                       required. The notice is a DRAFT: use only on a test
 *                       account. Never accepted by default.
 *   --keep              keep the smoke document instead of deleting it
 *   --allow-production  skip the production guard (see below)
 *   --allow-insecure-http  allow a plain http:// target that is not loopback.
 *                       Without it such a target is refused before login, so
 *                       the password and token never cross the network in clear.
 *
 * Production guard: the run is refused when the host contains "prod", or when
 * it is not clearly non-production (localhost/127.0.0.1, or a dev, staging,
 * stg, test or local label in the host name). Unclear hosts are refused too.
 *
 * Cost: a run uses about 3 or more of the account's daily AI quota (one
 * suggestion, one planning job, plus retries) and of the global quota.
 *
 * Steps: models, login, consent, setup, suggestion, cache hit, planning job,
 * quota counters, cleanup. Each prints PASS, FAIL or SKIP. Exit codes: 0 clean
 * run, 1 any FAIL (or bad env/refused target), 2 skipped (no OpenRouter key).
 * A planning job passes only with a non-null model and successful retrieval
 * that matched and used the smoke section.
 *
 * Output is limited to field names, counts, ids, status codes and model
 * names. It never prints the password, tokens, the API key, section text,
 * suggestion text or model output.
 */
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  globalQuotaKey,
  userQuotaKey,
  utcDay,
} from '../src/infrastructure/ai/redis-ai-quota';
import {
  StepResult,
  StepStatus,
  classifyForbidden,
  countersRose,
  findStructuredFreeModels,
  isInsecureRemoteHttp,
  isLikelyProduction,
  planningJobProblems,
  summarizePlanningJob,
  summarizeSteps,
} from '../src/shared/ai-smoke/ai-smoke-checks';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const DEFAULT_TIMEOUT_MS = 30_000;
const AI_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;
const POLL_DEADLINE_MS = 180_000;

// Fixed, synthetic, non-sensitive. The run id keeps each run's text unique, so
// the first suggestion is never a cache hit from an earlier run.
const RUN_ID = randomUUID().slice(0, 8);
const SECTION_TITLE = `Smoke test section ${RUN_ID}`;
const SECTION_CONTENT =
  `Synthetic smoke test text, run ${RUN_ID}. ` +
  'The garden has three flower beds. The first bed grows tulips in spring. ' +
  'The second bed grows tomatoes in summer. The third bed is empty for now.';
const PLANNING_PROMPT =
  'Outline a short plan for tending the garden described in my document.';

class ScriptError extends Error {}
/** Later steps cannot run; stop the sequence (cleanup still runs). */
class AbortRun extends Error {}

const results: StepResult[] = [];

// Captured once so every counter read uses the same UTC day. If the run
// crosses UTC midnight the API counts under the new day's key while these
// reads still use this one, so the counter-based steps are skipped then.
const RUN_DAY = utcDay(new Date());
const CROSSED_MIDNIGHT = 'run crossed UTC midnight';

function crossedUtcMidnight(): boolean {
  return utcDay(new Date()) !== RUN_DAY;
}

// Set as soon as a document exists, so `finally` can always delete it.
const cleanupTarget: { documentId?: string } = {};

function report(name: string, status: StepStatus, detail = ''): void {
  results.push({ name, status });
  console.log(`${status.padEnd(4)} ${name}${detail ? `: ${detail}` : ''}`);
}

interface ApiResponse {
  status: number;
  body: Record<string, unknown> | null;
  retryAfter: string | null;
}

async function http(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<ApiResponse> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    // Label only: error causes can echo the URL or headers.
    throw new ScriptError(
      `${label} -> ${timedOut ? `timed out after ${timeoutMs / 1000}s` : 'network error (is the API reachable?)'}`,
    );
  }
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed === 'object' && parsed !== null) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Empty or non-JSON body (e.g. 204).
  }
  return {
    status: res.status,
    body,
    retryAfter: res.headers.get('retry-after'),
  };
}

function createApi(baseUrl: string) {
  let token: string | undefined;
  return {
    setToken(value: string) {
      token = value;
    },
    call(
      method: string,
      path: string,
      body?: unknown,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    ): Promise<ApiResponse> {
      return http(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        timeoutMs,
        `${method} ${path}`,
      );
    },
  };
}
type Api = ReturnType<typeof createApi>;

/** A short, safe description of a non-success response (no bodies echoed). */
function describe(res: ApiResponse): string {
  if (res.status === 429) {
    return `HTTP 429, AI quota exhausted for today (Retry-After: ${res.retryAfter ?? 'unknown'}s, until the next UTC midnight)`;
  }
  if (res.status === 403) {
    const kind = classifyForbidden(res.body);
    if (kind === 'consent')
      return 'HTTP 403, AI consent required (AI_CONSENT_REQUIRED)';
    if (kind === 'email')
      return 'HTTP 403, email not verified for this account';
  }
  const error = res.body?.error;
  const code = typeof error === 'string' ? ` (${error})` : '';
  return `HTTP ${res.status}${code}`;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ---------- Redis (read only) ----------

interface Counters {
  user: number;
  global: number;
}

function redisConfigured(): boolean {
  return Boolean(process.env.REDIS_HOST && process.env.REDIS_PORT);
}

async function readCounters(
  userId: string,
  day: string,
): Promise<Counters | null> {
  const client = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
    ...(['true', '1'].includes(process.env.REDIS_TLS ?? '') ? { tls: {} } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    commandTimeout: 3000,
    connectTimeout: 5000,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const [user, global] = await Promise.all([
      client.get(userQuotaKey(userId, day)),
      client.get(globalQuotaKey(day)),
    ]);
    return { user: Number(user ?? 0), global: Number(global ?? 0) };
  } catch {
    return null;
  } finally {
    client.disconnect();
  }
}

// ---------- Steps ----------

async function stepModels(): Promise<void> {
  const name = 'Models';
  try {
    const res = await http(
      OPENROUTER_MODELS_URL,
      {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      },
      DEFAULT_TIMEOUT_MS,
      'GET openrouter models',
    );
    const data = res.body?.data;
    if (res.status !== 200 || !Array.isArray(data)) {
      report(name, 'FAIL', `HTTP ${res.status} (not fatal; check the key)`);
      return;
    }
    const { count, ids } = findStructuredFreeModels(data);
    report(
      name,
      'PASS',
      `${count} free model(s) support response_format/structured_outputs. ` +
        `Candidates for OPENROUTER_MODEL: ${ids.join(', ') || 'none'}`,
    );
  } catch (err) {
    report(
      name,
      'FAIL',
      `${err instanceof ScriptError ? err.message : 'unexpected error'} (not fatal)`,
    );
  }
}

async function stepLogin(api: Api): Promise<void> {
  const res = await api.call('POST', '/auth/login', {
    email: process.env.SMOKE_EMAIL,
    password: process.env.SMOKE_PASSWORD,
  });
  const token = str(res.body?.accessToken);
  if (res.status >= 300 || !token) {
    report('Login', 'FAIL', describe(res));
    throw new AbortRun();
  }
  api.setToken(token);
  report('Login', 'PASS', `HTTP ${res.status}`);
}

async function stepConsent(api: Api, acceptNotice: boolean): Promise<string> {
  const me = await api.call('GET', '/users/me');
  const userId = str(me.body?.id);
  const consent = me.body?.ai_consent as
    | { required?: boolean; current_version?: string }
    | undefined;
  if (me.status !== 200 || !userId || !consent) {
    report('Consent', 'FAIL', `could not read ai_consent (${describe(me)})`);
    throw new AbortRun();
  }
  if (!consent.required) {
    report('Consent', 'PASS', 'already accepted for the current notice');
    return userId;
  }
  if (!acceptNotice) {
    report(
      'Consent',
      'FAIL',
      'AI consent is required for this account. Re-run with --accept-notice to ' +
        'accept the AI notice for it. The notice is a draft: use that flag only ' +
        'on a throwaway test account.',
    );
    throw new AbortRun();
  }
  const accepted = await api.call('POST', '/users/me/ai-consent', {
    version: consent.current_version,
  });
  if (accepted.status !== 200) {
    report(
      'Consent',
      'FAIL',
      `accepting the notice failed (${describe(accepted)})`,
    );
    throw new AbortRun();
  }
  report(
    'Consent',
    'PASS',
    `accepted notice version ${consent.current_version}`,
  );
  return userId;
}

async function stepSetup(
  api: Api,
): Promise<{ documentId: string; sectionId: string }> {
  const doc = await api.call('POST', '/documents', {
    title: `Smoke test document ${RUN_ID}`,
    docType: 'planning',
  });
  const documentId = str(doc.body?.id);
  if (doc.status !== 201 || !documentId) {
    report('Setup', 'FAIL', `creating the document: ${describe(doc)}`);
    throw new AbortRun();
  }
  // Recorded now so cleanup deletes the document even if the section fails.
  cleanupTarget.documentId = documentId;
  const section = await api.call('POST', `/documents/${documentId}/sections`, {
    title: SECTION_TITLE,
    content: SECTION_CONTENT,
  });
  const sectionId = str(section.body?.id);
  if (section.status !== 201 || !sectionId) {
    report('Setup', 'FAIL', `creating the section: ${describe(section)}`);
    throw new AbortRun();
  }
  report('Setup', 'PASS', `document ${documentId}, section ${sectionId}`);
  return { documentId, sectionId };
}

async function requestSuggestion(
  api: Api,
  sectionId: string,
): Promise<{ res: ApiResponse; ms: number }> {
  const started = Date.now();
  const res = await api.call(
    'POST',
    `/sections/${sectionId}/suggestions`,
    { featureType: 'suggestion' },
    AI_TIMEOUT_MS,
  );
  return { res, ms: Date.now() - started };
}

async function stepSuggestion(
  api: Api,
  sectionId: string,
): Promise<{ text: string; ms: number }> {
  const name = 'Suggestion';
  const { res, ms } = await requestSuggestion(api, sectionId);
  if (res.status === 503) {
    report(
      name,
      'FAIL',
      `${describe(res)}. If the message is "AI not configured", OPENROUTER_API_KEY is not set on the deployed service.`,
    );
    throw new AbortRun();
  }
  const text = str(res.body?.suggested_text);
  const model = str(res.body?.model);
  if (res.status !== 201 || !text || !model) {
    report(
      name,
      'FAIL',
      res.status === 201
        ? 'HTTP 201 but suggested_text or model is empty'
        : describe(res),
    );
    throw new AbortRun();
  }
  report(name, 'PASS', `model ${model}, ${(ms / 1000).toFixed(1)}s`);
  return { text, ms };
}

async function stepCacheHit(
  api: Api,
  sectionId: string,
  first: { text: string; ms: number },
  userId: string,
  before: Counters | null,
): Promise<void> {
  const name = 'Cache hit';
  const { res, ms } = await requestSuggestion(api, sectionId);
  const text = str(res.body?.suggested_text);
  if (res.status !== 201 || !text) {
    report(name, 'FAIL', describe(res));
    return;
  }
  const timing = `first ${(first.ms / 1000).toFixed(1)}s, second ${(ms / 1000).toFixed(1)}s`;
  if (text !== first.text) {
    report(
      name,
      'FAIL',
      `the second response differs from the first (${timing})`,
    );
    return;
  }
  const after = before ? await readCounters(userId, RUN_DAY) : null;
  if (before && crossedUtcMidnight()) {
    report(name, 'SKIP', CROSSED_MIDNIGHT);
    return;
  }
  if (before && after) {
    const used = after.user - before.user;
    report(
      name,
      used === 0 ? 'PASS' : 'FAIL',
      used === 0
        ? `identical text and the user counter did not move (${before.user}); no attempt was used (${timing})`
        : `identical text but the user counter rose by ${used}, so an attempt was used (${timing})`,
    );
    return;
  }
  // Timing alone can pass or fail wrongly, so it never decides.
  report(
    name,
    'SKIP',
    `inconclusive: identical text and ${ms}ms vs ${first.ms}ms, no counters to confirm`,
  );
}

async function stepPlanningJob(api: Api, documentId: string): Promise<void> {
  const name = 'Planning job';
  const submit = await api.call(
    'POST',
    '/planning-jobs',
    { prompt: PLANNING_PROMPT, documentId },
    AI_TIMEOUT_MS,
  );
  const jobId = str(submit.body?.job_id);
  if (submit.status !== 202 || !jobId) {
    report(name, 'FAIL', `submit: ${describe(submit)}`);
    return;
  }
  const deadline = Date.now() + POLL_DEADLINE_MS;
  let job: ApiResponse | null = null;
  while (Date.now() < deadline) {
    job = await api.call('GET', `/planning-jobs/${jobId}`);
    const status = str(job.body?.status);
    if (job.status !== 200) {
      report(name, 'FAIL', `polling: ${describe(job)}`);
      return;
    }
    if (status === 'completed' || status === 'failed') break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const status = str(job?.body?.status);
  if (!job || status !== 'completed') {
    if (status === 'failed') {
      const errorCode = str(job?.body?.error_code);
      const hint = errorCode?.startsWith('CONTEXT_ENGINE')
        ? '. This points to the context engine or the broker, not the AI layer.'
        : '';
      report(
        name,
        'FAIL',
        `job failed: error_code ${errorCode ?? 'none'}${hint}`,
      );
    } else {
      report(
        name,
        'FAIL',
        `not finished after ${POLL_DEADLINE_MS / 1000}s (last status ${status ?? 'unknown'}); the document is being deleted while the job is not finished, so the job may fail on its own`,
      );
    }
    return;
  }
  const body = job.body as Record<string, unknown>;
  const result = body.result as Record<string, unknown> | null;
  if (!result) {
    report(name, 'FAIL', 'completed but result is empty');
    return;
  }
  const model = str(body.model);
  const summary = summarizePlanningJob({
    result,
    context_used: body.context_used as Record<string, unknown> | null,
  });
  const retrieval = Object.entries(summary.retrieval)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const detail =
    `model ${model ?? 'null'}, ${summary.suggestionCount} suggestion(s), ` +
    `sources [${summary.sourceIds.join(', ')}], retrieval ${retrieval || 'none'}`;
  const problems = planningJobProblems(summary, model);
  if (summary.invalidSourceIds.length > 0) {
    problems.push(
      `source ids not of the form S<number>: ${summary.invalidSourceIds.join(', ')}`,
    );
  }
  if (problems.length > 0) {
    report(name, 'FAIL', `${detail}; ${problems.join('; ')}`);
    return;
  }
  report(name, 'PASS', detail);
}

function stepCounters(before: Counters | null, after: Counters | null): void {
  const name = 'Quota counters';
  if (!redisConfigured()) {
    report(name, 'SKIP', 'REDIS_HOST/REDIS_PORT not set');
    return;
  }
  if (crossedUtcMidnight()) {
    report(name, 'SKIP', CROSSED_MIDNIGHT);
    return;
  }
  if (!before || !after) {
    report(name, 'FAIL', 'could not read the quota counters from Redis');
    return;
  }
  const detail = `user ${before.user} -> ${after.user}, global ${before.global} -> ${after.global}`;
  report(name, countersRose(before, after) ? 'PASS' : 'FAIL', detail);
}

async function stepCleanup(api: Api, keep: boolean): Promise<void> {
  const name = 'Cleanup';
  const id = cleanupTarget.documentId;
  if (!id) {
    report(name, 'SKIP', 'nothing was created');
    return;
  }
  if (keep) {
    report(name, 'SKIP', `--keep: document ${id} left in place`);
    return;
  }
  try {
    const res = await api.call('DELETE', `/documents/${id}`);
    if (res.status === 204) {
      report(name, 'PASS', `deleted document ${id}`);
    } else {
      report(
        name,
        'FAIL',
        `could not delete document ${id}: ${describe(res)}; delete it by hand`,
      );
    }
  } catch {
    report(name, 'FAIL', `could not delete document ${id}; delete it by hand`);
  }
}

// ---------- Main ----------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new ScriptError(`${name} is required`);
  return value;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flag = (f: string) => args.includes(f);

  const baseUrl = requireEnv('API_BASE_URL').replace(/\/+$/, '');
  requireEnv('SMOKE_EMAIL');
  requireEnv('SMOKE_PASSWORD');

  if (!process.env.OPENROUTER_API_KEY) {
    console.log(
      'SKIPPED: OPENROUTER_API_KEY is not set, so the live AI smoke test did not run. This is not a pass (exit 2).',
    );
    return 2;
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ScriptError('API_BASE_URL is not a valid URL');
  }
  console.log(`Target: ${url.host}`);
  console.log(
    "Warning: this run consumes about 3 or more of the account's daily AI quota (and of the global quota).",
  );
  if (isInsecureRemoteHttp(url) && !flag('--allow-insecure-http')) {
    throw new ScriptError(
      'API_BASE_URL is plain http:// to a non-loopback host; refusing to send credentials in clear text. Use https, or pass --allow-insecure-http.',
    );
  }
  if (isLikelyProduction(url.hostname) && !flag('--allow-production')) {
    throw new ScriptError(
      `${url.host} looks like production (or is not clearly non-production); refusing. Pass --allow-production to override.`,
    );
  }

  await stepModels();

  const api = createApi(baseUrl);
  try {
    await stepLogin(api);
    const userId = await stepConsent(api, flag('--accept-notice'));
    const { documentId, sectionId } = await stepSetup(api);

    const redis = redisConfigured();
    const start = redis ? await readCounters(userId, RUN_DAY) : null;
    const first = await stepSuggestion(api, sectionId);
    const afterFirst = redis ? await readCounters(userId, RUN_DAY) : null;
    await stepCacheHit(api, sectionId, first, userId, afterFirst);
    await stepPlanningJob(api, documentId);
    stepCounters(start, redis ? await readCounters(userId, RUN_DAY) : null);
  } catch (err) {
    if (!(err instanceof AbortRun)) {
      report(
        'Run',
        'FAIL',
        err instanceof ScriptError
          ? err.message
          : 'unexpected failure (network or malformed response)',
      );
    } else {
      console.log('Stopping: later steps depend on the failed one.');
    }
  } finally {
    await stepCleanup(api, flag('--keep'));
  }

  const summary = summarizeSteps(results);
  console.log(summary.line);
  return summary.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(
      err instanceof ScriptError
        ? `Error: ${err.message}`
        : 'Error: unexpected failure',
    );
    process.exit(1);
  });
