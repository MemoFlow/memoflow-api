import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('mission_progress')
// Deliberate addition beyond docs/database-schema.md — the atomicity
// boundary `incrementAtomic`'s upsert-then-guarded-UPDATE relies on: exactly
// one progress row per (user, mission).
@Index('IDX_mission_progress_user_mission', ['userId', 'missionId'], {
  unique: true,
})
export class MissionProgressOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Index()
  @Column({ type: 'uuid', name: 'mission_id' })
  missionId: string;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
