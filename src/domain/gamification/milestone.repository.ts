import { Milestone } from './milestone.entity';

export const MILESTONE_REPOSITORY = Symbol('MilestoneRepository');

export interface AwardMilestoneData {
  userId: string;
  documentId: string;
  milestoneType: string;
  xpAwarded: number;
}

export interface AwardMilestoneResult {
  milestone: Milestone;
  /** The user's `xp`/`level` after this award's XP was applied. */
  xp: number;
  level: number;
}

export interface MilestoneRepository {
  /**
   * Idempotent award on the unique (user_id, document_id, milestone_type)
   * tuple, PLUS the `users.xp`/`level` increment for `xpAwarded` — both in
   * one DB transaction, so a crash between "milestone inserted" and "xp
   * incremented" can never happen (the idempotency guard below would
   * otherwise prevent any retry from ever awarding the lost XP).
   *
   * Returns `null` when a milestone for that exact tuple was already
   * awarded (a double `document.created`/`section.created`/
   * `section.updated` event must never double-award XP) — `users` is left
   * untouched in that case.
   */
  awardOnce(data: AwardMilestoneData): Promise<AwardMilestoneResult | null>;
  findByUser(userId: string): Promise<Milestone[]>;
}
