import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('connector_connections')
@Index('UQ_connector_user_provider', ['userId', 'provider'], { unique: true })
export class ConnectorConnectionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Index()
  @Column({ type: 'varchar' })
  provider: string;

  @Index()
  @Column({ type: 'varchar', name: 'composio_account_id', nullable: true })
  composioAccountId: string | null;

  @Index()
  @Column({ type: 'varchar' })
  status: string;

  @Column({ type: 'timestamptz', name: 'connected_at', nullable: true })
  connectedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
