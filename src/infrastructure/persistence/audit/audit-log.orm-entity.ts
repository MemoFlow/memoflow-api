import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * `user_id` deliberately has no plain single-column index — the composite
 * `(user_id, created_at)` index below covers both "FK lookup" and "events
 * for a user, newest first" (db-mentor's recommendation for this slice), so
 * a separate plain `user_id` index would be redundant.
 *
 * The migration hand-tunes this index's `created_at` column to `DESC`
 * (TypeORM's `@Index` decorator has no per-column sort-order option) — see
 * the comment in `CreateAuditLogs` for why that doesn't drift against this
 * entity on a future `migration:generate`.
 */
@Entity('audit_logs')
@Index('IDX_audit_logs_user_created', ['userId', 'createdAt'])
export class AuditLogOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar' })
  action: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  ip: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
