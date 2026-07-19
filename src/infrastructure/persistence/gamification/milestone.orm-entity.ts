import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('milestones')
// Deliberate addition beyond docs/database-schema.md — idempotent-award
// guard for `awardOnce`: ON CONFLICT DO NOTHING on this exact tuple is what
// makes a double `document.created`/`section.created`/`section.updated`
// event never double-award XP.
@Index(
  'IDX_milestones_user_document_type',
  ['userId', 'documentId', 'milestoneType'],
  {
    unique: true,
  },
)
export class MilestoneOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Index()
  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  @Column({ type: 'varchar', name: 'milestone_type' })
  milestoneType: string;

  @Column({ type: 'int', name: 'xp_awarded' })
  xpAwarded: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
