/**
 * Promotes an existing user to the admin role and re-enables the account if
 * it was disabled (so this is also the recovery path when every admin is
 * disabled).
 *
 * Usage: ADMIN_EMAIL=person@example.com npm run admin:promote
 * (exact-match lookup on the email, no case folding).
 *
 * Connects with the POSTGRES_* variables from the environment (or `.env`).
 * Idempotent: running it for an enabled admin changes nothing.
 * Exits non-zero if ADMIN_EMAIL is unset or no such user exists. Unlike the
 * dev seed, it runs under any NODE_ENV.
 */
import 'dotenv/config';
import dataSource from '../src/infrastructure/persistence/typeorm.data-source';
import { UserRole } from '../src/domain/users/user-role';
import { UserOrmEntity } from '../src/infrastructure/persistence/users/user.orm-entity';

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  if (!email) {
    throw new Error('ADMIN_EMAIL is not set');
  }

  await dataSource.initialize();
  try {
    const repository = dataSource.getRepository(UserOrmEntity);
    const user = await repository.findOne({ where: { email } });
    if (!user) {
      throw new Error(`no user found with email ${email}`);
    }
    const wasDisabled = user.disabledAt !== null;
    if (user.role === (UserRole.Admin as string) && !wasDisabled) {
      console.log(`[promote-admin] ${email} is already an admin`);
      return;
    }
    await repository.update(
      { id: user.id },
      { role: UserRole.Admin, disabledAt: null },
    );
    console.log(`[promote-admin] ${email} is now an admin`);
    if (wasDisabled) {
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
