/**
 * Domain entity for `document_templates` (see docs/database-schema.md) — the
 * join row recorded when a template is applied to a document.
 * Plain TypeScript — no typeorm imports.
 */
export class DocumentTemplate {
  id: string;
  documentId: string;
  templateId: string;
  appliedAt: Date;
  customised: boolean;

  constructor(props: {
    id: string;
    documentId: string;
    templateId: string;
    appliedAt: Date;
    customised: boolean;
  }) {
    this.id = props.id;
    this.documentId = props.documentId;
    this.templateId = props.templateId;
    this.appliedAt = props.appliedAt;
    this.customised = props.customised;
  }
}
