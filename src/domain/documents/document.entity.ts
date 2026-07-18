/**
 * Domain entity for `documents` (see docs/database-schema.md).
 * Plain TypeScript — no typeorm imports.
 */
export class Document {
  id: string;
  userId: string;
  title: string;
  docType: string;
  status: string;
  styleConfig: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: {
    id: string;
    userId: string;
    title: string;
    docType: string;
    status: string;
    styleConfig: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = props.id;
    this.userId = props.userId;
    this.title = props.title;
    this.docType = props.docType;
    this.status = props.status;
    this.styleConfig = props.styleConfig;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
