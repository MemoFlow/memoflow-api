import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DAILY_MISSION_REPOSITORY } from '../../domain/gamification/daily-mission.repository';
import type { DailyMissionRepository } from '../../domain/gamification/daily-mission.repository';
import { DailyMission } from '../../domain/gamification/daily-mission.entity';
import { Milestone } from '../../domain/gamification/milestone.entity';
import { MILESTONE_REPOSITORY } from '../../domain/gamification/milestone.repository';
import type { MilestoneRepository } from '../../domain/gamification/milestone.repository';
import { MISSION_PROGRESS_REPOSITORY } from '../../domain/gamification/mission-progress.repository';
import type { MissionProgressRepository } from '../../domain/gamification/mission-progress.repository';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';

export interface GetMyGamificationInput {
  userId: string;
}

export interface TodayMissionView {
  mission: DailyMission;
  progress: number;
  completed: boolean;
}

export interface MyGamificationResult {
  xp: number;
  level: number;
  milestones: Milestone[];
  todayMissions: TodayMissionView[];
}

@Injectable()
export class GetMyGamificationUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    @Inject(MILESTONE_REPOSITORY)
    private readonly milestoneRepository: MilestoneRepository,
    @Inject(DAILY_MISSION_REPOSITORY)
    private readonly dailyMissionRepository: DailyMissionRepository,
    @Inject(MISSION_PROGRESS_REPOSITORY)
    private readonly missionProgressRepository: MissionProgressRepository,
  ) {}

  async execute(input: GetMyGamificationInput): Promise<MyGamificationResult> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new NotFoundException(`User ${input.userId} not found`);
    }

    const [milestones, todayMissionDefs] = await Promise.all([
      this.milestoneRepository.findByUser(input.userId),
      this.dailyMissionRepository.findActiveOn(new Date()),
    ]);

    const progressRows =
      await this.missionProgressRepository.findByUserAndMissions(
        input.userId,
        todayMissionDefs.map((mission) => mission.id),
      );
    const progressByMissionId = new Map(
      progressRows.map((progress) => [progress.missionId, progress]),
    );

    const todayMissions: TodayMissionView[] = todayMissionDefs.map(
      (mission) => {
        const progress = progressByMissionId.get(mission.id);
        return {
          mission,
          progress: progress?.progress ?? 0,
          completed: progress?.completed ?? false,
        };
      },
    );

    return {
      xp: user.xp,
      level: user.level,
      milestones,
      todayMissions,
    };
  }
}
