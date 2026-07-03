/**
 * Idempotent dev seed. Run via `npm run db:seed` (databases must be up).
 *
 * Grows with the feature modules: each module adds its own seed block below,
 * guarded by an existence check so re-running never duplicates data.
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import dataSource from '../src/infrastructure/persistence/typeorm.data-source';
import { UserOrmEntity } from '../src/infrastructure/persistence/users/user.orm-entity';

const BCRYPT_SALT_ROUNDS = 10;

const SEED_USERS = [
  {
    email: 'admin@memoflow.dev',
    password: 'dev-password-123',
    displayName: 'Admin Dev',
    role: 'admin',
  },
  {
    email: 'writer@memoflow.dev',
    password: 'dev-password-123',
    displayName: 'Writer Dev',
    role: 'user',
  },
];

// Dev seed data must never reach the staging or production databases.
const nodeEnv = process.env.NODE_ENV ?? 'development';
if (nodeEnv === 'staging' || nodeEnv === 'production') {
  console.error(
    `[seed] refusing to run with NODE_ENV=${nodeEnv} — this seed is for development/test only`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  await dataSource.initialize();
  console.log('[seed] connected to PostgreSQL');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(mongoUri);
  console.log('[seed] connected to MongoDB');

  const userRepository = dataSource.getRepository(UserOrmEntity);
  for (const seedUser of SEED_USERS) {
    const existing = await userRepository.findOne({
      where: { email: seedUser.email },
    });
    if (existing) {
      console.log(`[seed] user ${seedUser.email} already exists — skipping`);
      continue;
    }

    const passwordHash = await bcrypt.hash(
      seedUser.password,
      BCRYPT_SALT_ROUNDS,
    );
    await userRepository.save(
      userRepository.create({
        email: seedUser.email,
        passwordHash,
        displayName: seedUser.displayName,
        role: seedUser.role,
      }),
    );
    console.log(`[seed] created user ${seedUser.email}`);
  }

  await mongoose.disconnect();
  await dataSource.destroy();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
