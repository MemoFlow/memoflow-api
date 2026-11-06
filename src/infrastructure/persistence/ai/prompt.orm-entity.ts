import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// One active prompt per feature type, enforced by the database so two
// concurrent activations can't both win.
@Index('UQ_prompts_active_feature_type', ['featureType'], {
  unique: true,
  where: '"is_active" = true',
})
@Index('UQ_prompts_feature_type_version', ['featureType', 'version'], {
  unique: true,
})
@Entity('prompts')
export class PromptOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', name: 'feature_type' })
  featureType: string;

  @Column({ type: 'varchar' })
  version: string;

  @Column({ type: 'text', name: 'system_template' })
  systemTemplate: string;

  // The USER message template; the column keeps its original name.
  @Column({ type: 'text' })
  template: string;

  @Column({ type: 'boolean', name: 'user_invocable', default: false })
  userInvocable: boolean;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
