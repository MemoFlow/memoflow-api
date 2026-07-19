import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GetLeaderboardUseCase } from './application/gamification/get-leaderboard.use-case';
import { GetMyGamificationUseCase } from './application/gamification/get-my-gamification.use-case';
import { HandleGamificationEventUseCase } from './application/gamification/handle-gamification-event.use-case';
import { DAILY_MISSION_REPOSITORY } from './domain/gamification/daily-mission.repository';
import { MILESTONE_REPOSITORY } from './domain/gamification/milestone.repository';
import { MISSION_PROGRESS_REPOSITORY } from './domain/gamification/mission-progress.repository';
import { DailyMissionOrmEntity } from './infrastructure/persistence/gamification/daily-mission.orm-entity';
import { DailyMissionTypeOrmRepository } from './infrastructure/persistence/gamification/daily-mission.typeorm.repository';
import { MilestoneOrmEntity } from './infrastructure/persistence/gamification/milestone.orm-entity';
import { MilestoneTypeOrmRepository } from './infrastructure/persistence/gamification/milestone.typeorm.repository';
import { MissionProgressOrmEntity } from './infrastructure/persistence/gamification/mission-progress.orm-entity';
import { MissionProgressTypeOrmRepository } from './infrastructure/persistence/gamification/mission-progress.typeorm.repository';
import { GamificationController } from './presentation/gamification/gamification.controller';
import { GamificationListener } from './presentation/gamification/gamification.listener';
import { UsersModule } from './users.module';

/**
 * Roadmap item 6 — gamification (PG). Imports `UsersModule` to reuse its
 * exported `USER_REPOSITORY` — `GetMyGamificationUseCase` and
 * `GetLeaderboardUseCase` read user profiles/rankings through it (same
 * convention `AiModule`/`TemplatesModule` document for depending on another
 * feature's domain repository interface, not its use-cases). XP/level writes
 * do NOT go through it: they happen inside the gamification repositories'
 * own transactions (awardOnce / incrementAtomic touch `users` via the shared
 * DataSource so an award and its XP commit or roll back together).
 *
 * `GamificationListener` is registered as a plain provider (not a
 * controller) — mirrors `PlanningGateway` in `ContextModule`: Nest's
 * `EventEmitterModule` discovery service finds `@OnEvent` methods on any
 * provider in the graph, and `EventEmitterModule.forRoot()` (registered
 * globally in `AppModule`) makes `EventEmitter2` itself available here
 * without a separate import.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MilestoneOrmEntity,
      DailyMissionOrmEntity,
      MissionProgressOrmEntity,
    ]),
    UsersModule,
  ],
  controllers: [GamificationController],
  providers: [
    { provide: MILESTONE_REPOSITORY, useClass: MilestoneTypeOrmRepository },
    {
      provide: DAILY_MISSION_REPOSITORY,
      useClass: DailyMissionTypeOrmRepository,
    },
    {
      provide: MISSION_PROGRESS_REPOSITORY,
      useClass: MissionProgressTypeOrmRepository,
    },
    HandleGamificationEventUseCase,
    GetMyGamificationUseCase,
    GetLeaderboardUseCase,
    GamificationListener,
  ],
  exports: [
    MILESTONE_REPOSITORY,
    DAILY_MISSION_REPOSITORY,
    MISSION_PROGRESS_REPOSITORY,
  ],
})
export class GamificationModule {}
