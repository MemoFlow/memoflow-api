import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('templates')
export class TemplateOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Index()
  @Column({ type: 'varchar', name: 'doc_type' })
  docType: string;

  @Index()
  @Column({ type: 'varchar' })
  scope: string;

  // null = system template.
  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @Column({ type: 'jsonb', name: 'style_config', nullable: true })
  styleConfig: Record<string, unknown> | null;

  @Index()
  @Column({ type: 'boolean', name: 'is_published', default: false })
  isPublished: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
