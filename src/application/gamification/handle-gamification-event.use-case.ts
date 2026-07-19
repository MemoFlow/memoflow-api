import { Inject, Injectable } from '@nestjs/common';
import { DAILY_MISSION_REPOSITORY } from '../../domain/gamification/daily-mission.repository';
import type { DailyMissionRepository } from '../../domain/gamification/daily-mission.repository';
import { MILESTONE_REPOSITORY } from '../../domain/gamification/milestone.repository';
import type { MilestoneRepository } from '../../domain/gamification/milestone.repository';
import { MISSION_PROGRESS_REPOSITORY } from '../../domain/gamification/mission-progress.repository';
import type { MissionProgressRepository } from '../../domain/gamification/mission-progress.repository';
import { GamificationEventPayload } from './gamification-event';
import { MILESTONE_RULES } from './milestone-rules';

/**
 * Reacts to a documents domain event (`document.created`, `section.created`,
 * `section.updated`) by (a) awarding any milestone whose rule matches, and
 * (b) advancing progress on today's active daily missions whose
 * `criteria.event` matches. The `users.xp`/`level` increment for each award
 * happens INSIDE `MilestoneRepository.awardOnce` /
 * `MissionProgressRepository.incrementAtomic`'s own DB transaction (not a
 * separate call from here) — a crash between "award recorded" and "xp
 * incremented" would otherwise permanently lose that XP, since the
 * idempotency guard on each award path means it can never be retried.
 *
 * Deliberately lets errors propagate — `GamificationListener` (presentation)
 * is the layer that catches and logs, per CLAUDE.md ("a gamification failure
 * must NEVER fail the originating request"); keeping the try/catch out of
 * here keeps this unit-testable against the plain success/idempotency paths.
 */
@Injectable()
export class HandleGamificationEventUseCase {
  constructor(
    @Inject(MILESTONE_REPOSITORY)
    private readonly milestoneRepository: MilestoneRepository,
    @Inject(DAILY_MISSION_REPOSITORY)
    private readonly dailyMissionRepository: DailyMissionRepository,
    @Inject(MISSION_PROGRESS_REPOSITORY)
    private readonly missionProgressRepository: MissionProgressRepository,
  ) {}

  async execute(
    event: string,
    payload: GamificationEventPayload,
  ): Promise<void> {
    await this.applyMilestoneRules(event, payload);
    await this.applyMissionProgress(event, payload);
  }

  private async applyMilestoneRules(
    event: string,
    payload: GamificationEventPayload,
  ): Promise<void> {
    const matchingRules = MILESTONE_RULES.filter(
      (rule) =>
        rule.event === event && (!rule.condition || rule.condition(payload)),
    );

    for (const rule of matchingRules) {
      // `null` means this (user, document, milestoneType) was already
      // awarded — `awardOnce` itself already left `users` untouched for it.
      await this.milestoneRepository.awardOnce({
        userId: payload.userId,
        documentId: payload.documentId,
        milestoneType: rule.milestoneType,
        xpAwarded: rule.xp,
      });
    }
  }

  private async applyMissionProgress(
    event: string,
    payload: GamificationEventPayload,
  ): Promise<void> {
    const activeMissions = await this.dailyMissionRepository.findActiveOn(
      new Date(),
    );
    const matchingMissions = activeMissions.filter(
      (mission) => mission.criteria.event === event,
    );

    for (const mission of matchingMissions) {
      // XP is awarded exactly once — `incrementAtomic` itself only touches
      // `users` on the call whose increment flips `completed` false -> true.
      await this.missionProgressRepository.incrementAtomic(
        payload.userId,
        mission.id,
        mission.criteria.target,
        mission.xpReward,
      );
    }
  }
}
