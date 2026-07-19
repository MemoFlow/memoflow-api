import {
  DocumentVersion,
  DocumentVersionMetadata,
  SectionSnapshot,
} from './document-version.entity';

export const DOCUMENT_VERSION_REPOSITORY = Symbol('DocumentVersionRepository');

export interface CreateDocumentVersionData {
  documentId: string;
  userId: string;
  label?: string | null;
  sectionsSnapshot: SectionSnapshot[];
}

export interface DocumentVersionRepository {
  /**
   * Creates a new immutable version snapshot. `version` is computed
   * internally as `(maxVersion(documentId) ?? 0) + 1` — callers never pass
   * one in. Two concurrent saves for the same document can both compute the
   * same `version` and race on the unique `{ document_id, version }` compound
   * index (Mongo duplicate-key error, code 11000); the implementation
   * recomputes `maxVersion` and retries exactly once before letting the
   * error propagate.
   */
  create(data: CreateDocumentVersionData): Promise<DocumentVersion>;
  /** Full snapshot lookup by version id (Mongo ObjectId string). */
  findById(id: string): Promise<DocumentVersion | null>;
  /** Metadata-only projection (no `sectionsSnapshot`), ordered `savedAt` desc. */
  findByDocumentId(documentId: string): Promise<DocumentVersionMetadata[]>;
  /** Highest existing `version` for a document, or `null` if it has none yet. */
  maxVersion(documentId: string): Promise<number | null>;
}
