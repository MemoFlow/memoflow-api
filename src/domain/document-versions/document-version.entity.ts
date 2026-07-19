/**
 * Domain entity for the `document_versions` Mongo collection (see
 * docs/database-schema.md). Plain TypeScript — no mongoose imports.
 *
 * An immutable snapshot of a document's sections at save time.
 */
export interface SectionSnapshot {
  title: string;
  content: string;
  order: number;
  status: string;
  wordCount: number;
}

export class DocumentVersion {
  id: string;
  documentId: string;
  userId: string;
  version: number;
  label: string | null;
  sectionsSnapshot: SectionSnapshot[];
  savedAt: Date;

  constructor(props: {
    id: string;
    documentId: string;
    userId: string;
    version: number;
    label: string | null;
    sectionsSnapshot: SectionSnapshot[];
    savedAt: Date;
  }) {
    this.id = props.id;
    this.documentId = props.documentId;
    this.userId = props.userId;
    this.version = props.version;
    this.label = props.label;
    this.sectionsSnapshot = props.sectionsSnapshot;
    this.savedAt = props.savedAt;
  }
}

/**
 * Lightweight projection used for listing a document's versions — omits
 * `sectionsSnapshot` (the whole point of the list endpoint is not shipping
 * every snapshot's full payload over the wire) in favour of a count.
 */
export interface DocumentVersionMetadata {
  id: string;
  documentId: string;
  version: number;
  label: string | null;
  savedAt: Date;
  sectionCount: number;
}
