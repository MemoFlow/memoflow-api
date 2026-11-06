/**
 * Port for finding the sections a planning job may draw on. Implemented over
 * Postgres full-text search today; a vector search can replace it later
 * without touching the pipeline. Domain imports nothing external.
 */
export const SECTION_RETRIEVER = Symbol('SectionRetriever');

/** Default number of sections returned by `search`. */
export const DEFAULT_SECTION_RETRIEVAL_LIMIT = 8;

export interface SectionSearchInput {
  /**
   * Whose sections may be returned. Required and always taken from the job,
   * never from the prompt: an implementation must not return any section of
   * a document this user does not own.
   */
  userId: string;
  /** Document the job is bound to, if any. */
  documentId?: string | null;
  /** Section the job is bound to, if any. */
  sectionId?: string | null;
  /** Free-form natural language (the job prompt). May be empty. */
  query: string;
  /** Maximum rows; defaults to `DEFAULT_SECTION_RETRIEVAL_LIMIT`. */
  limit?: number;
}

export interface RetrievedSection {
  sectionId: string;
  documentId: string;
  documentTitle: string;
  title: string;
  content: string;
  /** True when the section belongs to the document the job is bound to. */
  inBoundDocument: boolean;
  /** True when the section matched the query terms. */
  matched: boolean;
}

export interface SectionRetriever {
  /**
   * Order: the bound section, then matching sections of the bound document,
   * then its other sections by `order` (so a bound job always has its
   * document even with no match), then matches in the user's other documents
   * by relevance.
   */
  search(input: SectionSearchInput): Promise<RetrievedSection[]>;
}
