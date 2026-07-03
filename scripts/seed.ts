/**
 * Idempotent dev seed. Run via `npm run db:seed` (databases must be up).
 *
 * Grows with the feature modules: each module adds its own seed block below,
 * guarded by an existence check so re-running never duplicates data.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import dataSource from '../src/infrastructure/persistence/typeorm.data-source';

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

  // No modules yet — nothing to seed. First real block lands with the users module.
  console.log('[seed] nothing to seed yet');

  await mongoose.disconnect();
  await dataSource.destroy();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
