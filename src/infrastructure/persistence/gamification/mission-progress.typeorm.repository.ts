import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { MissionProgress } from '../../../domain/gamification/mission-progress.entity';
import {
  IncrementMissionProgressResult,
  MissionProgressRepository,
} from '../../../domain/gamification/mission-progress.repository';
import { UserOrmEntity } from '../users/user.orm-entity';
import { XP_PER_LEVEL } from '../shared/xp-level.constants';
import { MissionProgressOrmEntity } from './mission-progress.orm-entity';

@Injectable()
export class MissionProgressTypeOrmRepository implements MissionProgressRepository {
  constructor(
    @InjectRepository(MissionProgressOrmEntity)
    private readonly repository: Repository<MissionProgressOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async incrementAtomic(
    userId: string,
    missionId: string,
    target: number,
    xpReward: number,
  ): Promise<IncrementMissionProgressResult> {
    // One transaction for the whole increment (+ the xp/level update when it
    // completes the mission) — mirrors `MilestoneTypeOrmRepository.awardOnce`
    // / `DocumentTemplateTypeOrmRepository.applyToDocument` reaching into
    // another feature's ORM entity (`UserOrmEntity`) via the shared
    // `DataSource`, so a crash between "mission completed" and "xp
    // incremented" can never happen.
    return this.dataSource.transaction(async (manager) => {
      const missionProgressRepo = manager.getRepository(
        MissionProgressOrmEntity,
      );

      // Upsert a baseline row first (`ON CONFLICT DO NOTHING` against
      // `IDX_mission_progress_user_mission`) so the guarded UPDATE below
      // always has a row to act on, even on the mission's first-ever event
      // for this user today.
      await missionProgressRepo
        .createQueryBuilder()
        .insert()
        .into(MissionProgressOrmEntity)
        .values({ userId, missionId, progress: 0, completed: false })
        .orIgnore()
        .execute();

      // Single conditional UPDATE — the `completed = false` guard is the
      // atomicity boundary: two concurrent increments of the same mission
      // can't both flip `completed` and both trigger an XP award, unlike a
      // read-then-write which races.
      const result = await missionProgressRepo
        .createQueryBuilder()
        .update(MissionProgressOrmEntity)
        .set({
          progress: () => 'progress + 1',
          completed: () => '(progress + 1) >= :target',
          updatedAt: () => 'now()',
        })
        .where('user_id = :userId', { userId })
        .andWhere('mission_id = :missionId', { missionId })
        .andWhere('completed = false')
        .setParameter('target', target)
        .returning('*')
        .execute();

      const rows = result.raw as Record<string, unknown>[] | undefined;
      if (!rows || rows.length === 0) {
        // No row matched `completed = false` — the mission was already
        // completed earlier today. Return its current (unchanged) state so
        // the caller can still report progress, with `justCompleted: false`
        // so XP is never awarded twice.
        const existing = await missionProgressRepo.findOneOrFail({
          where: { userId, missionId },
        });
        return { progress: this.toDomain(existing), justCompleted: false };
      }

      const progress = this.toDomainFromRaw(rows[0]);
      if (!progress.completed) {
        return { progress, justCompleted: false };
      }

      // This increment is the one that flipped `completed` — award the
      // mission's xp in the SAME transaction.
      const userRepo = manager.getRepository(UserOrmEntity);
      const userUpdateResult = await userRepo
        .createQueryBuilder()
        .update(UserOrmEntity)
        .set({
          xp: () => 'xp + :delta',
          level: () => `FLOOR((xp + :delta) / ${XP_PER_LEVEL}) + 1`,
        })
        .where('id = :userId', { userId })
        .setParameter('delta', xpReward)
        .returning(['xp', 'level'])
        .execute();

      const userRow = (
        userUpdateResult.raw as { xp: number; level: number }[] | undefined
      )?.[0];
      if (!userRow) {
        // Unreachable in practice: `mission_progress.user_id` has an `ON
        // DELETE CASCADE` FK to `users`, so the upsert above would already
        // have failed (aborting this transaction) had `userId` not existed.
        // Kept as a defensive guard rather than returning a bogus xp/level.
        throw new Error(
          `incrementAtomic: xp update affected no rows for user ${userId}`,
        );
      }

      return {
        progress,
        justCompleted: true,
        xp: Number(userRow.xp),
        level: Number(userRow.level),
      };
    });
  }

  async findByUserAndMissions(
    userId: string,
    missionIds: string[],
  ): Promise<MissionProgress[]> {
    if (missionIds.length === 0) {
      return [];
    }
    const entities = await this.repository.find({
      where: { userId, missionId: In(missionIds) },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  private toDomain(entity: MissionProgressOrmEntity): MissionProgress {
    return new MissionProgress({
      id: entity.id,
      userId: entity.userId,
      missionId: entity.missionId,
      progress: entity.progress,
      completed: entity.completed,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  /**
   * Maps a raw row returned by `.returning('*')` — snake_case DB column
   * names, not the ORM entity's camelCase properties.
   */
  private toDomainFromRaw(row: Record<string, unknown>): MissionProgress {
    return new MissionProgress({
      id: row.id as string,
      userId: row.user_id as string,
      missionId: row.mission_id as string,
      progress: row.progress as number,
      completed: row.completed as boolean,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    });
  }
}
