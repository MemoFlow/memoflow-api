import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { MissionCriteria } from '../../../domain/gamification/daily-mission.entity';

@Entity('daily_missions')
export class DailyMissionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  code: string;

  @Column({ type: 'varchar' })
  description: string;

  @Column({ type: 'int', name: 'xp_reward' })
  xpReward: number;

  @Column({ type: 'jsonb' })
  criteria: MissionCriteria;

  @Index()
  @Column({ type: 'date', name: 'active_date' })
  activeDate: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
