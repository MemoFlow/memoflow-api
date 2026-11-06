import { ApiProperty } from '@nestjs/swagger';
import { LeaderboardEntry } from '../../../application/gamification/get-leaderboard.use-case';

export class LeaderboardEntryResponseDto {
  @ApiProperty()
  is_me: boolean;

  @ApiProperty()
  display_name: string;

  @ApiProperty()
  xp: number;

  @ApiProperty()
  level: number;

  static fromEntry(entry: LeaderboardEntry): LeaderboardEntryResponseDto {
    const dto = new LeaderboardEntryResponseDto();
    dto.is_me = entry.isMe;
    dto.display_name = entry.displayName;
    dto.xp = entry.xp;
    dto.level = entry.level;
    return dto;
  }
}
