import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetLeaderboardUseCase } from '../../application/gamification/get-leaderboard.use-case';
import { GetMyGamificationUseCase } from '../../application/gamification/get-my-gamification.use-case';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GamificationMeResponseDto } from './dto/gamification-me-response.dto';
import { LeaderboardEntryResponseDto } from './dto/leaderboard-entry-response.dto';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';

@ApiTags('gamification')
@Controller('gamification')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GamificationController {
  constructor(
    private readonly getMyGamificationUseCase: GetMyGamificationUseCase,
    private readonly getLeaderboardUseCase: GetLeaderboardUseCase,
  ) {}

  @Get('me')
  @ApiOperation({ summary: "Get the current user's gamification profile" })
  @ApiResponse({ status: 200, type: GamificationMeResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@CurrentUser() user: User): Promise<GamificationMeResponseDto> {
    const result = await this.getMyGamificationUseCase.execute({
      userId: user.id,
    });
    return GamificationMeResponseDto.fromResult(result);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Top users by XP' })
  @ApiResponse({ status: 200, type: [LeaderboardEntryResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getLeaderboard(
    @Query() query: LeaderboardQueryDto,
  ): Promise<LeaderboardEntryResponseDto[]> {
    const entries = await this.getLeaderboardUseCase.execute(query.limit);
    return entries.map((entry) => LeaderboardEntryResponseDto.fromEntry(entry));
  }
}
