import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ai_suggestions')
export class AiSuggestionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Plain index deliberate addition beyond docs/database-schema.md — the
  // suggestions-list/generate endpoints look up by section_id on every call.
  @Index()
  @Column({ type: 'uuid', name: 'section_id' })
  sectionId: string;

  // Plain index deliberate addition beyond docs/database-schema.md —
  // ownership checks flow through the section/document chain today, but
  // this is on the FK and a natural future "my suggestions" query path.
  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', name: 'feature_type' })
  featureType: string;

  @Column({ type: 'text', name: 'original_text' })
  originalText: string;

  @Column({ type: 'text', name: 'suggested_text' })
  suggestedText: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: string;

  @Column({ type: 'varchar', name: 'prompt_version' })
  promptVersion: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
