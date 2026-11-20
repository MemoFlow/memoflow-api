import { EntityManager } from 'typeorm';
import { UserOrmEntity } from '../users/user.orm-entity';
import { DAILY_XP_CAP, XP_PER_LEVEL } from './xp-level.constants';

export interface XpGrantInput {
  /** XP the award is worth before the daily cap. */
  delta: number;
  xpToday: number;
  /** `YYYY-MM-DD` (UTC) of the day `xpToday` counts, or null. */
  xpTodayDate: string | null;
  /** `YYYY-MM-DD` (UTC) of "now". */
  today: string;
  cap?: number;
}

export interface XpGrant {
  /** XP actually granted: min(delta, cap - xp earned today), floored at 0. */
  granted: number;
  /** XP earned today including this grant. */
  xpToday: number;
}

export function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Pure daily-cap arithmetic; `xpToday` resets when the stored date is not today. */
export function computeXpGrant(input: XpGrantInput): XpGrant {
  const cap = input.cap ?? DAILY_XP_CAP;
  const earnedToday = input.xpTodayDate === input.today ? input.xpToday : 0;
  const granted = Math.max(0, Math.min(input.delta, cap - earnedToday));
  return { granted, xpToday: earnedToday + granted };
}

export interface XpGrantPlan {
  /** XP the award will actually grant after the daily cap. */
  granted: number;
  xp: number;
  level: number;
  xpToday: number;
  today: string;
}

/**
 * Step 1 of a capped XP grant: locks the user row (held until the caller's
 * transaction ends, so concurrent grants for one user serialize) and works
 * out what the daily cap allows — without writing. Lets the caller record
 * the granted amount on its own award row before `commitXpGrant`. Returns
 * null when the user doesn't exist. `level` is recomputed from the granted
 * amount only.
 */
export async function planXpGrant(
  manager: EntityManager,
  userId: string,
  delta: number,
  now: Date = new Date(),
): Promise<XpGrantPlan | null> {
  const user = await manager.getRepository(UserOrmEntity).findOne({
    where: { id: userId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!user) {
    return null;
  }
  const today = utcDateString(now);
  const { granted, xpToday } = computeXpGrant({
    delta,
    xpToday: user.xpToday,
    xpTodayDate: user.xpTodayDate,
    today,
  });
  const xp = user.xp + granted;
  return {
    granted,
    xp,
    level: Math.floor(xp / XP_PER_LEVEL) + 1,
    xpToday,
    today,
  };
}

/** Step 2: persists a plan from `planXpGrant` (same transaction). */
export async function commitXpGrant(
  manager: EntityManager,
  userId: string,
  plan: XpGrantPlan,
): Promise<void> {
  await manager.getRepository(UserOrmEntity).update(
    { id: userId },
    {
      xp: plan.xp,
      level: plan.level,
      xpToday: plan.xpToday,
      xpTodayDate: plan.today,
    },
  );
}
