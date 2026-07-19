import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('template_sections')
@Index('IDX_template_sections_template_order', ['templateId', 'order'])
export class TemplateSectionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'template_id' })
  templateId: string;

  // Deliberate addition beyond docs/database-schema.md — sections created
  // from a template need headings.
  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'int', name: 'order' })
  order: number;

  @Column({ type: 'int', name: 'word_count_min' })
  wordCountMin: number;

  @Column({ type: 'int', name: 'word_count_max' })
  wordCountMax: number;

  @Column({ type: 'boolean', name: 'is_required', default: false })
  isRequired: boolean;
}
