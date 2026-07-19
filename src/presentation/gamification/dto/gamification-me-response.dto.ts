import { ApiProperty } from '@nestjs/swagger';
import { MyGamificationResult } from '../../../application/gamification/get-my-gamification.use-case';
import { MilestoneResponseDto } from './milestone-response.dto';
import { TodayMissionResponseDto } from './today-mission-response.dto';

export class GamificationMeResponseDto {
  @ApiProperty()
  xp: number;

  @ApiProperty()
  level: number;

  @ApiProperty({ type: [MilestoneResponseDto] })
  milestones: MilestoneResponseDto[];

  @ApiProperty({ type: [TodayMissionResponseDto] })
  today_missions: TodayMissionResponseDto[];

  static fromResult(result: MyGamificationResult): GamificationMeResponseDto {
    const dto = new GamificationMeResponseDto();
    dto.xp = result.xp;
    dto.level = result.level;
    dto.milestones = result.milestones.map((milestone) =>
      MilestoneResponseDto.fromEntity(milestone),
    );
    dto.today_missions = result.todayMissions.map((view) =>
      TodayMissionResponseDto.fromView(view),
    );
    return dto;
  }
}
