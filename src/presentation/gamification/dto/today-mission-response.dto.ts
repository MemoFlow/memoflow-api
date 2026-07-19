import { ApiProperty } from '@nestjs/swagger';
import { DailyMission } from '../../../domain/gamification/daily-mission.entity';
import { TodayMissionView } from '../../../application/gamification/get-my-gamification.use-case';

export class DailyMissionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  xp_reward: number;

  @ApiProperty({ example: { event: 'section.updated', target: 3 } })
  criteria: { event: string; target: number };

  static fromEntity(mission: DailyMission): DailyMissionResponseDto {
    const dto = new DailyMissionResponseDto();
    dto.id = mission.id;
    dto.code = mission.code;
    dto.description = mission.description;
    dto.xp_reward = mission.xpReward;
    dto.criteria = mission.criteria;
    return dto;
  }
}

export class TodayMissionResponseDto {
  @ApiProperty({ type: DailyMissionResponseDto })
  mission: DailyMissionResponseDto;

  @ApiProperty()
  progress: number;

  @ApiProperty()
  completed: boolean;

  static fromView(view: TodayMissionView): TodayMissionResponseDto {
    const dto = new TodayMissionResponseDto();
    dto.mission = DailyMissionResponseDto.fromEntity(view.mission);
    dto.progress = view.progress;
    dto.completed = view.completed;
    return dto;
  }
}
