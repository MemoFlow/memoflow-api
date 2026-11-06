import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LeadSignalType } from '../../../domain/leads/lead-enums';
import { LeadSignal } from '../../../domain/leads/lead-signal.entity';
import { LeadSignalRepository } from '../../../domain/leads/lead-signal.repository';
import { LeadSignalOrmEntity } from './lead-signal.orm-entity';

@Injectable()
export class LeadSignalTypeOrmRepository implements LeadSignalRepository {
  constructor(
    @InjectRepository(LeadSignalOrmEntity)
    private readonly repository: Repository<LeadSignalOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async record(userId: string, type: LeadSignalType, now: Date): Promise<void> {
    // The unique (user_id, type) index is the atomicity boundary: concurrent
    // calls both land on the one row and each increments it.
    await this.dataSource.query(
      `INSERT INTO lead_signals
         (id, user_id, type, first_seen_at, last_seen_at, occurrences)
       VALUES (uuid_generate_v4(), $1, $2, $3, $3, 1)
       ON CONFLICT (user_id, type) DO UPDATE SET
         occurrences = lead_signals.occurrences + 1,
         last_seen_at = GREATEST(lead_signals.last_seen_at, EXCLUDED.last_seen_at)`,
      [userId, type, now],
    );
  }

  async findByUserId(userId: string): Promise<LeadSignal[]> {
    const entities = await this.repository.find({
      where: { userId },
      order: { firstSeenAt: 'ASC' },
    });
    return entities.map(
      (entity) =>
        new LeadSignal({
          id: entity.id,
          userId: entity.userId,
          type: entity.type as LeadSignalType,
          firstSeenAt: entity.firstSeenAt,
          lastSeenAt: entity.lastSeenAt,
          occurrences: entity.occurrences,
        }),
    );
  }
}
