/**
 * Promotes an existing user to the admin role and re-enables the account if
 * it was disabled (so this is also the recovery path when every admin is
 * disabled).
 *
 * Usage: ADMIN_EMAIL=person@example.com npm run admin:promote
 * (the address is trimmed and lowercased before lookup, like every other
 * email entry point).
 *
 * Connects with the POSTGRES_* variables from the environment (or `.env`).
 * Idempotent: running it for an enabled admin changes nothing. A change also
 * writes `audit_logs` rows (`user.role_changed`, and `user.enabled` if it
 * re-enabled the account) in the same transaction.
 * Exits non-zero if ADMIN_EMAIL is unset or no such user exists. Unlike the
 * dev seed, it runs under any NODE_ENV.
 */
import 'dotenv/config';
import dataSource from '../src/infrastructure/persistence/typeorm.data-source';
import { normalizeEmail } from '../src/domain/users/normalize-email';
import { promoteAdmin } from '../src/infrastructure/persistence/users/promote-admin';

async function main(): Promise<void> {
  const rawEmail = process.env.ADMIN_EMAIL?.trim();
  if (!rawEmail) {
    throw new Error('ADMIN_EMAIL is not set');
  }
  const email = normalizeEmail(rawEmail);

  await dataSource.initialize();
  try {
    const result = await promoteAdmin(dataSource, email);
    if (result.status === 'not_found') {
      throw new Error(`no user found with email ${email}`);
    }
    if (result.status === 'unchanged') {
      console.log(`[promote-admin] ${email} is already an admin`);
      return;
    }
    console.log(`[promote-admin] ${email} is now an admin`);
    if (result.wasDisabled) {
      console.log(
        `[promote-admin] ${email} was disabled and has been re-enabled`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(
    '[promote-admin] failed:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
