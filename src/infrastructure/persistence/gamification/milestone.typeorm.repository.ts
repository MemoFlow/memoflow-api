import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Milestone } from '../../../domain/gamification/milestone.entity';
import {
  AwardMilestoneData,
  AwardMilestoneResult,
  MilestoneRepository,
} from '../../../domain/gamification/milestone.repository';
import { commitXpGrant, planXpGrant } from '../shared/xp-grant';
import { MilestoneOrmEntity } from './milestone.orm-entity';

@Injectable()
export class MilestoneTypeOrmRepository implements MilestoneRepository {
  constructor(
    @InjectRepository(MilestoneOrmEntity)
    private readonly repository: Repository<MilestoneOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async awardOnce(
    data: AwardMilestoneData,
  ): Promise<AwardMilestoneResult | null> {
    // One transaction for both writes — mirrors
    // `DocumentTemplateTypeOrmRepository.applyToDocument` reaching into
    // another feature's ORM entity (`UserOrmEntity`) via the shared
    // `DataSource` rather than a `UsersModule`-scoped provider, so both the
    // milestone insert and the xp/level update commit or roll back together.
    return this.dataSource.transaction(async (manager) => {
      const milestoneRepo = manager.getRepository(MilestoneOrmEntity);

      // Lock the user row and work out the daily-capped XP first, so the
      // milestone row can record the XP actually granted. The row is
      // inserted either way (idempotency is unchanged); only the granted XP
      // is capped. Nothing is written to `users` unless the insert wins.
      const grant = await planXpGrant(manager, data.userId, data.xpAwarded);
      if (!grant) {
        throw new Error(
          `awardOnce: xp update affected no rows for user ${data.userId}`,
        );
      }

      // `ON CONFLICT DO NOTHING` against `IDX_milestones_user_document_type`
      // (the entity's unique composite index) is the atomicity boundary —
      // two concurrent awards for the same (user, document, milestone_type)
      // can't both win, unlike a find-then-insert which races.
      const insertResult = await milestoneRepo
        .createQueryBuilder()
        .insert()
        .into(MilestoneOrmEntity)
        .values({
          userId: data.userId,
          documentId: data.documentId,
          milestoneType: data.milestoneType,
          xpAwarded: grant.granted,
        })
        .orIgnore()
        .returning('*')
        .execute();

      const milestoneRows = insertResult.raw as
        | Record<string, unknown>[]
        | undefined;
      if (!milestoneRows || milestoneRows.length === 0) {
        // Already awarded — leave `users` untouched entirely.
        return null;
      }
      const milestone = this.toDomainFromRaw(milestoneRows[0]);

      await commitXpGrant(manager, data.userId, grant);

      return { milestone, xp: grant.xp, level: grant.level };
    });
  }

  async findByUser(userId: string): Promise<Milestone[]> {
    const entities = await this.repository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  private toDomain(entity: MilestoneOrmEntity): Milestone {
    return new Milestone({
      id: entity.id,
      userId: entity.userId,
      documentId: entity.documentId,
      milestoneType: entity.milestoneType,
      xpAwarded: entity.xpAwarded,
      createdAt: entity.createdAt,
    });
  }

  /**
   * Maps a raw row returned by `.returning('*')` — snake_case DB column
   * names, not the ORM entity's camelCase properties.
   */
  private toDomainFromRaw(row: Record<string, unknown>): Milestone {
    return new Milestone({
      id: row.id as string,
      userId: row.user_id as string,
      documentId: row.document_id as string,
      milestoneType: row.milestone_type as string,
      xpAwarded: row.xp_awarded as number,
      createdAt: row.created_at as Date,
    });
  }
}
