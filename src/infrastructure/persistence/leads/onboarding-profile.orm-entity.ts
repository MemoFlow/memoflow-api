import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * No `@ManyToOne` relation for `user_id`: the FK to `users` (ON DELETE
 * CASCADE) is hand-added in the CreateLeadScoring migration, as for the
 * gamification entities.
 */
@Entity('onboarding_profiles')
export class OnboardingProfileOrmEntity {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar' })
  persona: string;

  @Column({ type: 'varchar', name: 'deliverable_type' })
  deliverableType: string;

  @Column({ type: 'date', name: 'due_date' })
  dueDate: string;

  @Column({ type: 'varchar', name: 'academic_level' })
  academicLevel: string;

  @Column({ type: 'varchar', length: 120, name: 'school_name', nullable: true })
  schoolName: string | null;

  @Column({ type: 'text', array: true, name: 'work_tools' })
  workTools: string[];

  @Column({ type: 'text', array: true })
  blockers: string[];

  @Column({ type: 'varchar', name: 'acquisition_channel' })
  acquisitionChannel: string;

  @Column({ type: 'boolean', name: 'marketing_opt_in', default: false })
  marketingOptIn: boolean;

  @Column({ type: 'timestamptz', name: 'marketing_opt_in_at' })
  marketingOptInAt: Date;

  @Column({ type: 'timestamptz', name: 'submitted_at' })
  submittedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
