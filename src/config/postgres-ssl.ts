/**
 * Single source of truth for the Postgres TLS options, used by both the
 * runtime connection (`app.module.ts`) and the standalone TypeORM CLI data
 * source (`typeorm.data-source.ts`) so they cannot drift.
 *
 * Certificates are verified by default. Managed providers such as Neon
 * present a valid public-CA chain and hostname, so no relaxation is needed
 * for them. `POSTGRES_SSL_REJECT_UNAUTHORIZED=false` exists only for a
 * database with a private CA on the development tier; boot refuses it on
 * staging and production (see `env.validation.ts`).
 */

/** Case-insensitive "true" check for POSTGRES_SSL (accepts parsed booleans too). */
export function parsePostgresSsl(value: unknown): boolean {
  return String(value).toLowerCase() === 'true';
}

/**
 * Strict: unset or blank means true (verify); otherwise only "true" or
 * "false" (case-insensitive) are accepted. Anything else throws, so a typo
 * can never silently turn certificate verification off.
 */
export function parsePostgresSslRejectUnauthorized(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === '') return true;
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  throw new Error(
    "POSTGRES_SSL_REJECT_UNAUTHORIZED must be 'true' or 'false' (or unset)",
  );
}

/**
 * Returns the boot-failure message when verification is off on a deployed
 * tier, else null. Shared by `validate()` and the CLI data source.
 */
export function postgresSslTierViolation(
  nodeEnv: string | undefined,
  rejectUnauthorized: boolean,
): string | null {
  if (
    !rejectUnauthorized &&
    (nodeEnv === 'staging' || nodeEnv === 'production')
  ) {
    return `POSTGRES_SSL_REJECT_UNAUTHORIZED: cannot be false when NODE_ENV is ${nodeEnv}`;
  }
  return null;
}

/** For the CLI data source: parse strictly and enforce the tier rule. */
export function assertPostgresSslSafe(
  nodeEnv: string | undefined,
  rawRejectUnauthorized: unknown,
): void {
  const effective = parsePostgresSslRejectUnauthorized(rawRejectUnauthorized);
  const violation = postgresSslTierViolation(nodeEnv, effective);
  if (violation) {
    throw new Error(`Invalid environment configuration:\n- ${violation}`);
  }
}

export function postgresSslOptions(
  ssl: unknown,
  rejectUnauthorized: unknown,
): false | { rejectUnauthorized: boolean } {
  return parsePostgresSsl(ssl)
    ? {
        rejectUnauthorized:
          parsePostgresSslRejectUnauthorized(rejectUnauthorized),
      }
    : false;
}
