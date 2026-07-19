import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyMission } from '../../../domain/gamification/daily-mission.entity';
import { DailyMissionRepository } from '../../../domain/gamification/daily-mission.repository';
import { DailyMissionOrmEntity } from './daily-mission.orm-entity';

@Injectable()
export class DailyMissionTypeOrmRepository implements DailyMissionRepository {
  constructor(
    @InjectRepository(DailyMissionOrmEntity)
    private readonly repository: Repository<DailyMissionOrmEntity>,
  ) {}

  async findActiveOn(date: Date): Promise<DailyMission[]> {
    // `active_date` is a Postgres `date` column — compare on the UTC
    // calendar day only, never the time-of-day component.
    const dateOnly = date.toISOString().slice(0, 10);
    const entities = await this.repository
      .createQueryBuilder('mission')
      .where('mission.active_date = :dateOnly', { dateOnly })
      .getMany();
    return entities.map((entity) => this.toDomain(entity));
  }

  async findById(id: string): Promise<DailyMission | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  private toDomain(entity: DailyMissionOrmEntity): DailyMission {
    return new DailyMission({
      id: entity.id,
      code: entity.code,
      description: entity.description,
      xpReward: entity.xpReward,
      criteria: entity.criteria,
      activeDate: entity.activeDate,
      createdAt: entity.createdAt,
    });
  }
}
