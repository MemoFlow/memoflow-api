import { TemplateSection } from './template-section.entity';

/**
 * Domain entity for `templates` (see docs/database-schema.md).
 * Plain TypeScript — no typeorm imports. Embeds its ordered `sections`.
 */
export class Template {
  id: string;
  title: string;
  docType: string;
  scope: string;
  /** `null` = system template (not created by any user, not editable). */
  createdBy: string | null;
  styleConfig: Record<string, unknown> | null;
  isPublished: boolean;
  sections: TemplateSection[];
  createdAt: Date;
  updatedAt: Date;

  constructor(props: {
    id: string;
    title: string;
    docType: string;
    scope: string;
    createdBy: string | null;
    styleConfig: Record<string, unknown> | null;
    isPublished: boolean;
    sections: TemplateSection[];
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = props.id;
    this.title = props.title;
    this.docType = props.docType;
    this.scope = props.scope;
    this.createdBy = props.createdBy;
    this.styleConfig = props.styleConfig;
    this.isPublished = props.isPublished;
    this.sections = props.sections;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
