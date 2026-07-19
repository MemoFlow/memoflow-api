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
import { PromptOrmEntity } from '../src/infrastructure/persistence/ai/prompt.orm-entity';
import { DailyMissionOrmEntity } from '../src/infrastructure/persistence/gamification/daily-mission.orm-entity';
import { UserOrmEntity } from '../src/infrastructure/persistence/users/user.orm-entity';

const BCRYPT_SALT_ROUNDS = 10;

// Roadmap item 6 (gamification) — a few daily missions active "today"
// (UTC calendar day, matching `DailyMissionTypeOrmRepository.findActiveOn`).
// `code` is the natural idempotency key (re-running the seed for the same
// day must never create duplicates).
const SEED_DAILY_MISSIONS = [
  {
    code: 'write-3-sections',
    description: 'Update 3 sections today',
    xpReward: 15,
    criteria: { event: 'section.updated', target: 3 },
  },
  {
    code: 'create-a-section',
    description: 'Create a new section today',
    xpReward: 10,
    criteria: { event: 'section.created', target: 1 },
  },
  {
    code: 'start-a-document',
    description: 'Start a new document today',
    xpReward: 20,
    criteria: { event: 'document.created', target: 1 },
  },
];

// Roadmap item 5 (AI layer) — one active prompt per feature type. Simple
// placeholder templates: `generate-suggestion` substitutes `{{content}}`
// with the section's text; the planning worker records `{{version}}` on
// the job for observability but doesn't currently render this template
// into the planner call (see `ProcessPlanningJobUseCase`'s doc comment).
const SEED_PROMPTS = [
  {
    featureType: 'suggestion',
    version: 'v1',
    template:
      'Improve the clarity and flow of the following text, keeping its meaning intact:\n\n{{content}}',
  },
  {
    featureType: 'planning',
    version: 'v1',
    template:
      'Given the following prompt and gathered context, suggest a short outline:\n\n{{prompt}}',
  },
];

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

  const promptRepository = dataSource.getRepository(PromptOrmEntity);
  for (const seedPrompt of SEED_PROMPTS) {
    const existing = await promptRepository.findOne({
      where: { featureType: seedPrompt.featureType, isActive: true },
    });
    if (existing) {
      console.log(
        `[seed] active prompt for "${seedPrompt.featureType}" already exists — skipping`,
      );
      continue;
    }

    await promptRepository.save(
      promptRepository.create({
        featureType: seedPrompt.featureType,
        version: seedPrompt.version,
        template: seedPrompt.template,
        isActive: true,
      }),
    );
    console.log(`[seed] created active prompt for "${seedPrompt.featureType}"`);
  }

  const dailyMissionRepository = dataSource.getRepository(DailyMissionOrmEntity);
  const today = new Date();
  const todayDateOnly = today.toISOString().slice(0, 10);
  for (const seedMission of SEED_DAILY_MISSIONS) {
    const existing = await dailyMissionRepository
      .createQueryBuilder('mission')
      .where('mission.code = :code', { code: seedMission.code })
      .andWhere('mission.active_date = :activeDate', {
        activeDate: todayDateOnly,
      })
      .getOne();
    if (existing) {
      console.log(
        `[seed] daily mission "${seedMission.code}" for ${todayDateOnly} already exists — skipping`,
      );
      continue;
    }

    await dailyMissionRepository.save(
      dailyMissionRepository.create({
        code: seedMission.code,
        description: seedMission.description,
        xpReward: seedMission.xpReward,
        criteria: seedMission.criteria,
        activeDate: today,
      }),
    );
    console.log(
      `[seed] created daily mission "${seedMission.code}" for ${todayDateOnly}`,
    );
  }

  await mongoose.disconnect();
  await dataSource.destroy();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
