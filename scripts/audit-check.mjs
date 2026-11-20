#!/usr/bin/env node
// Dependency audit gate: fails on high/critical advisories unless they are in
// .github/audit-allowlist.json (with an unexpired `expires` date, UTC).
// Usage: node scripts/audit-check.mjs [--allowlist <path>]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argIdx = process.argv.indexOf('--allowlist');
const allowlistPath =
  argIdx > -1 && process.argv[argIdx + 1]
    ? resolve(process.argv[argIdx + 1])
    : resolve(root, '.github/audit-allowlist.json');

const die = (msg) => {
  console.error(`audit-check: ${msg}`);
  process.exit(1);
};

let allowlist;
try {
  allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
} catch (e) {
  die(`cannot read allowlist ${allowlistPath}: ${e.message}`);
}
if (!Array.isArray(allowlist)) die('allowlist must be a JSON array');
const isRealDate = (d) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') &&
  !Number.isNaN(Date.parse(d)) &&
  new Date(d).toISOString().startsWith(d);
const keyOf = (id, pkg) => `${id.toLowerCase()}|${pkg}`;
const seen = new Set();
for (const e of allowlist) {
  if (!e?.id || !e.package || !e.reason || !isRealDate(e.expires)) {
    die(
      `invalid allowlist entry (needs id, package, reason and a real expires YYYY-MM-DD): ${JSON.stringify(e)}`,
    );
  }
  const key = keyOf(e.id, e.package);
  if (seen.has(key)) die(`duplicate allowlist entry: ${e.id} (${e.package})`);
  seen.add(key);
}

const res = spawnSync('npm', ['audit', '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (res.error) die(`failed to run npm audit: ${res.error.message}`);
let report;
try {
  report = JSON.parse(res.stdout);
} catch {
  die(
    `could not parse npm audit output (exit ${res.status}): ${res.stderr || res.stdout}`,
  );
}
if (report.error || !report.vulnerabilities) {
  die(
    `npm audit returned no report: ${JSON.stringify(report.error ?? report)}`,
  );
}

// Collect high/critical advisories (object `via` entries only), dedupe by id + package.
const found = new Map();
for (const [pkg, vuln] of Object.entries(report.vulnerabilities)) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity))
      continue;
    const id =
      /GHSA-[a-z0-9-]+/i.exec(via.url ?? '')?.[0] ?? `source-${via.source}`;
    const name = via.name ?? pkg;
    const key = keyOf(id, name);
    if (!found.has(key)) {
      found.set(key, {
        id,
        package: name,
        severity: via.severity,
        title: via.title,
      });
    }
  }
}

const today = new Date().toISOString().slice(0, 10);
const dayMs = 86_400_000;
const daysLeft = (exp) =>
  Math.round((Date.parse(exp) - Date.parse(today)) / dayMs);
const byKey = new Map(allowlist.map((e) => [keyOf(e.id, e.package), e]));

const allowed = [];
const blocked = [];
for (const adv of found.values()) {
  const entry = byKey.get(keyOf(adv.id, adv.package));
  if (!entry) blocked.push({ ...adv, why: 'not allowlisted' });
  else if (entry.expires < today)
    blocked.push({ ...adv, why: `allowlist expired ${entry.expires}` });
  else
    allowed.push({
      ...adv,
      days: daysLeft(entry.expires),
      expires: entry.expires,
    });
}
const stale = allowlist.filter((e) => !found.has(keyOf(e.id, e.package)));

console.log(
  `audit-check: ${found.size} high/critical advisories (today ${today} UTC)\n`,
);
if (allowed.length) {
  console.log('ALLOWED:');
  for (const a of allowed) {
    console.log(
      `  ${a.id}  ${a.severity.padEnd(8)} ${a.package}  expires ${a.expires} (${a.days}d left)`,
    );
  }
}
if (blocked.length) {
  console.log('BLOCKED:');
  for (const b of blocked) {
    console.log(
      `  ${b.id}  ${b.severity.padEnd(8)} ${b.package}  ${b.why}  - ${b.title}`,
    );
  }
}
for (const s of stale) {
  console.warn(
    `WARNING: allowlist entry ${s.id} (${s.package}) matches no current advisory; remove it.`,
  );
}

if (blocked.length) die(`${blocked.length} blocking advisory(ies)`);
console.log('\naudit-check: OK');
