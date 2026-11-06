import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Admin-only data: never serialized on a user route. The FK to `users` is
 * hand-added in the CreateLeadScoring migration.
 */
@Entity('lead_scores')
@Check('CHK_lead_scores_tier', `"tier" IN ('hot', 'warm', 'cold')`)
export class LeadScoreOrmEntity {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Index()
  @Column({ type: 'int' })
  score: number;

  @Index()
  @Column({ type: 'varchar' })
  tier: string;

  @Column({ type: 'jsonb' })
  breakdown: { rule: string; points: number }[];

  @Column({ type: 'timestamptz', name: 'computed_at' })
  computedAt: Date;
}
