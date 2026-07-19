import { MissionProgress } from './mission-progress.entity';

export const MISSION_PROGRESS_REPOSITORY = Symbol('MissionProgressRepository');

interface IncrementMissionProgressNotCompleted {
  progress: MissionProgress;
  justCompleted: false;
}

interface IncrementMissionProgressJustCompleted {
  progress: MissionProgress;
  justCompleted: true;
  /** The user's `xp`/`level` after this completion's `xpReward` was applied. */
  xp: number;
  level: number;
}

/**
 * Discriminated on `justCompleted` — `xp`/`level` only exist on the
 * completion branch, since that's the only call that touched `users` at all.
 */
export type IncrementMissionProgressResult =
  | IncrementMissionProgressNotCompleted
  | IncrementMissionProgressJustCompleted;

export interface MissionProgressRepository {
  /**
   * Upserts a baseline (progress 0, completed false) row for
   * (userId, missionId) if none exists yet, then atomically increments
   * `progress` and flips `completed` when `progress >= target` — guarded so
   * an already-completed mission is never incremented again and its XP is
   * never double-awarded. When the increment flips `completed` to `true`,
   * the `users.xp`/`level` increment for `xpReward` happens in the SAME
   * transaction — a crash between "mission completed" and "xp incremented"
   * can never happen (the `completed = false` guard would otherwise prevent
   * any retry from ever awarding the lost XP).
   */
  incrementAtomic(
    userId: string,
    missionId: string,
    target: number,
    xpReward: number,
  ): Promise<IncrementMissionProgressResult>;
  findByUserAndMissions(
    userId: string,
    missionIds: string[],
  ): Promise<MissionProgress[]>;
}
