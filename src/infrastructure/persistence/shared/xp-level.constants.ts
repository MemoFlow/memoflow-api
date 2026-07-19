/**
 * 100 XP per level, level 1 at 0 XP. Shared by the gamification repositories
 * (`MilestoneTypeOrmRepository`, `MissionProgressTypeOrmRepository`) that
 * award XP against `users.xp`/`users.level` as part of their own award
 * transaction — `level = FLOOR((xp + delta) / XP_PER_LEVEL) + 1`, computed
 * in the same `UPDATE` statement as the xp increment, never read-modify-write.
 */
export const XP_PER_LEVEL = 100;
