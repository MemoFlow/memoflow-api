import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The unique (user_id, type) index is the atomicity boundary of
 * `LeadSignalTypeOrmRepository.record`'s upsert, and also serves lookups by
 * user. The FK to `users` is hand-added in the CreateLeadScoring migration.
 */
@Entity('lead_signals')
@Index('IDX_lead_signals_user_type', ['userId', 'type'], { unique: true })
export class LeadSignalOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ type: 'timestamptz', name: 'first_seen_at' })
  firstSeenAt: Date;

  @Column({ type: 'timestamptz', name: 'last_seen_at' })
  lastSeenAt: Date;

  @Column({ type: 'int', default: 1 })
  occurrences: number;
}
