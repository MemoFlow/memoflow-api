/**
 * Loads the starter template content (key points + guidance per section) into
 * an environment through its HTTP API. Owner-run: it needs admin credentials.
 *
 * Usage:
 *   API_BASE_URL=https://api.example.com ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *     npm run templates:load            # dry run: report only
 *   ... npm run templates:load -- --apply   # PATCH, read back, verify
 *
 * All three env vars are required (no defaults). Uses only the HTTP API
 * (POST /auth/login, GET /templates, PATCH /templates/:id, GET
 * /templates/:id); never the database. Reads
 * docs/plans/2026-11-06-template-content.json and matches each template by
 * exact title (docType and scope narrow the lookup).
 *
 * Behaviour:
 * - Dry run by default. Nothing is written without --apply.
 * - Prints the target host and mode before logging in.
 * - Aborts before any write if a template is missing or ambiguous, or if the
 *   deployed API doesn't store key_points/guidance yet (checked on the first
 *   matched template's list entry, in dry run too).
 * - --apply PATCHes ONLY `{ sections }` (sections are replaced wholesale), so
 *   it can't publish or rename a template, then reads each back and compares
 *   the sections. Templates are written one at a time, so a failure partway
 *   leaves earlier templates already written; the error lists them. Re-running
 *   is safe (idempotent).
 * - Every request has a 30s timeout.
 * - Prints only titles, counts and field names — never the password or token.
 * Exits non-zero on any failure or mismatch.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ActualTemplate,
  ExpectedTemplate,
  compareTemplateContent,
  storesTemplateContentFields,
} from '../src/shared/template-content/compare-template-content';

const CONTENT_FILE = resolve(
  __dirname,
  '../docs/plans/2026-11-06-template-content.json',
);

interface ApiTemplate extends ActualTemplate {
  id: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

class ScriptError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ScriptError(`${name} is required`);
  }
  return value;
}

async function call(
  baseUrl: string,
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<unknown> {
  const { token, ...rest } = init;
  const label = `${init.method ?? 'GET'} ${path}`;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...rest,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    // Method and path only: error causes could echo the URL or headers.
    throw new ScriptError(
      `${label} -> ${timedOut ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : 'network error'}`,
    );
  }
  if (!res.ok) {
    // Status and path only: bodies could echo credentials or content.
    throw new ScriptError(`${label} -> HTTP ${res.status}`);
  }
  return res.json();
}

async function run(written: string[]): Promise<void> {
  const apply = process.argv.includes('--apply');
  const rawBaseUrl = requireEnv('API_BASE_URL');
  const email = requireEnv('ADMIN_EMAIL');
  const password = requireEnv('ADMIN_PASSWORD');
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');

  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    throw new ScriptError('API_BASE_URL is not a valid URL');
  }
  console.log(`Target: ${host}, mode: ${apply ? 'APPLY' : 'dry-run'}`);

  const templates = JSON.parse(
    readFileSync(CONTENT_FILE, 'utf8'),
  ) as ExpectedTemplate[];

  const login = (await call(baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })) as { accessToken: string };
  const token = login.accessToken;

  // Resolve every template first so a bad title aborts before any write.
  const targets: { expected: ExpectedTemplate; listed: ApiTemplate }[] = [];
  let missing = 0;
  for (const expected of templates) {
    const query = new URLSearchParams({
      docType: expected.docType,
      scope: expected.scope,
    });
    const list = (await call(baseUrl, `/templates?${query.toString()}`, {
      token,
    })) as ApiTemplate[];
    const matches = list.filter((t) => t.title === expected.title);
    if (matches.length === 1) {
      console.log(
        `FOUND    "${expected.title}" (${expected.sections.length} sections)`,
      );
      targets.push({ expected, listed: matches[0] });
    } else {
      missing++;
      console.log(
        `${matches.length === 0 ? 'MISSING ' : 'AMBIGUOUS'} "${expected.title}" (${matches.length} matches)`,
      );
    }
  }
  if (missing > 0) {
    throw new ScriptError(
      `${missing} template(s) not found or ambiguous; nothing was written`,
    );
  }

  // Old API builds strip the fields from responses; detect that before any
  // write, from the first matched template's list entry (dry run included).
  if (!storesTemplateContentFields(targets[0].listed.sections)) {
    throw new ScriptError(
      "the deployed API doesn't store these fields yet (key_points/guidance absent from GET /templates); nothing was written",
    );
  }

  if (!apply) {
    console.log('Dry run: all templates found. Re-run with --apply to load.');
    return;
  }

  let failures = 0;
  for (const { expected, listed } of targets) {
    // Sections only: can't publish or rename a template as a side effect.
    await call(baseUrl, `/templates/${listed.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ sections: expected.sections }),
    });
    written.push(expected.title);
    const readBack = (await call(baseUrl, `/templates/${listed.id}`, {
      token,
    })) as ApiTemplate;

    const differences = compareTemplateContent(expected, readBack);
    if (differences.length === 0) {
      console.log(`OK       "${expected.title}"`);
    } else {
      failures++;
      console.log(`MISMATCH "${expected.title}"`);
      for (const difference of differences) {
        console.log(`           ${difference}`);
      }
    }
  }
  if (failures > 0) {
    throw new ScriptError(`${failures} template(s) did not read back as sent`);
  }
  console.log('All templates loaded and verified.');
}

async function main(): Promise<void> {
  const written: string[] = [];
  try {
    await run(written);
  } catch (err) {
    if (written.length > 0) {
      console.error(
        `Already written before the failure: ${written.map((t) => `"${t}"`).join(', ')}. Re-running is safe (idempotent).`,
      );
    }
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error(
    err instanceof ScriptError
      ? `Error: ${err.message}`
      : 'Error: unexpected failure (network or malformed response)',
  );
  process.exit(1);
});
