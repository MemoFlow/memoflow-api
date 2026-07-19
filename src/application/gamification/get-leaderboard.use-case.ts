import { Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';

export const DEFAULT_LEADERBOARD_LIMIT = 10;
export const MAX_LEADERBOARD_LIMIT = 50;

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  xp: number;
  level: number;
}

/**
 * Top-N users by XP. Projects only `displayName` (never `email` or
 * `passwordHash`) — the response DTO carries the same non-sensitive fields
 * straight through.
 */
@Injectable()
export class GetLeaderboardUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
  ) {}

  async execute(limit?: number): Promise<LeaderboardEntry[]> {
    const resolvedLimit = Math.min(
      Math.max(limit ?? DEFAULT_LEADERBOARD_LIMIT, 1),
      MAX_LEADERBOARD_LIMIT,
    );
    const users = await this.userRepository.findTopByXp(resolvedLimit);
    return users.map((user) => ({
      userId: user.id,
      displayName: user.displayName,
      xp: user.xp,
      level: user.level,
    }));
  }
}
