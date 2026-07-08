/**
 * Domain entity for `sections` (see docs/database-schema.md).
 * Plain TypeScript — no typeorm imports.
 */
export class Section {
  id: string;
  documentId: string;
  title: string;
  content: string;
  order: number;
  status: string;
  wordCount: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: {
    id: string;
    documentId: string;
    title: string;
    content: string;
    order: number;
    status: string;
    wordCount: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = props.id;
    this.documentId = props.documentId;
    this.title = props.title;
    this.content = props.content;
    this.order = props.order;
    this.status = props.status;
    this.wordCount = props.wordCount;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
