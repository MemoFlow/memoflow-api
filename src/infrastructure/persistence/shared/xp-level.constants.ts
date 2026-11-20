/**
 * 100 XP per level, level 1 at 0 XP. Shared by the gamification repositories
 * (`MilestoneTypeOrmRepository`, `MissionProgressTypeOrmRepository`) that
 * award XP against `users.xp`/`users.level` as part of their own award
 * transaction — `level = FLOOR((xp + delta) / XP_PER_LEVEL) + 1`, computed
 * in the same `UPDATE` statement as the xp increment, never read-modify-write.
 */
export const XP_PER_LEVEL = 100;

/**
 * Leaderboard integrity: the most XP one user can earn per UTC day, across
 * milestones and daily missions combined. Anything beyond it is recorded as
 * an award (idempotency is unchanged) but grants 0 XP.
 */
export const DAILY_XP_CAP = 300;
