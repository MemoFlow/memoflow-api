import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('document_templates')
export class DocumentTemplateOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  @Index()
  @Column({ type: 'uuid', name: 'template_id' })
  templateId: string;

  @Column({ type: 'timestamptz', name: 'applied_at' })
  appliedAt: Date;

  @Column({ type: 'boolean', default: false })
  customised: boolean;
}
