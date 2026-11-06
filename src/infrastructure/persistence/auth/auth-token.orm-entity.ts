import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserOrmEntity } from '../users/user.orm-entity';

@Entity('auth_tokens')
@Check(
  'CHK_auth_tokens_type',
  `"type" IN ('password_reset', 'email_verification')`,
)
@Index('IDX_auth_tokens_user_type_created', ['userId', 'type', 'createdAt'])
export class AuthTokenOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserOrmEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: UserOrmEntity;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ type: 'varchar', name: 'token_hash', unique: true })
  tokenHash: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
