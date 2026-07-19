import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { DEFAULT_LEADERBOARD_LIMIT } from '../../../application/gamification/get-leaderboard.use-case';

export class LeaderboardQueryDto {
  // Deliberately no `@Min`/`@Max` here — an out-of-range `limit` is clamped
  // by `GetLeaderboardUseCase` (1..`MAX_LEADERBOARD_LIMIT`), not rejected.
  // Only shape validation (`@IsInt`) belongs at the DTO boundary; the
  // clamping *range* is the use-case's business rule.
  @ApiProperty({
    required: false,
    default: DEFAULT_LEADERBOARD_LIMIT,
    description:
      'Values outside the supported range are clamped, not rejected.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
