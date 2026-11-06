import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  DEFAULT_SECTION_RETRIEVAL_LIMIT,
  RetrievedSection,
  SectionRetriever,
  SectionSearchInput,
} from '../../../domain/context/section-retriever.port';

/** Most distinct terms of the prompt that are searched for. */
export const MAX_QUERY_TERMS = 64;
/** Hard ceiling on `limit`, whatever the caller asks for. */
const MAX_LIMIT = 50;
/**
 * Content cut in SQL: the pipeline cuts far below this, so there is no point
 * moving a whole large section over the wire.
 */
const MAX_CONTENT_CHARS = 20_000;

interface Row {
  section_id: string;
  document_id: string;
  document_title: string;
  title: string;
  content: string;
  in_bound_document: boolean;
  matched: boolean;
}

/**
 * Postgres full-text retrieval over `sections.search_vector`. Everything is
 * parameterised, and both queries are scoped by `documents.user_id`, so
 * another user's section can never be returned, bound or not.
 *
 * A prompt is natural language, and `websearch_to_tsquery` would AND all its
 * words and match almost nothing. So the distinct lexemes of the prompt are
 * read back from Postgres (`to_tsvector('simple', ...)`, which also strips
 * punctuation and operators) and OR-ed as `plainto_tsquery` terms, each
 * passed as a bind parameter. The SQL text only ever varies by the number of
 * placeholders, never by the content of the prompt.
 *
 * Two queries, merged in order: (a) the bound section and the bound
 * document's sections, found by `document_id`; (b) matches in the user's other
 * documents, a plain `search_vector @@ query` predicate so the GIN index is
 * used instead of a scan over every section.
 */
@Injectable()
export class SectionRetrieverTypeOrm implements SectionRetriever {
  constructor(private readonly dataSource: DataSource) {}

  async search(input: SectionSearchInput): Promise<RetrievedSection[]> {
    const limit = Math.min(
      Math.max(Math.trunc(input.limit ?? DEFAULT_SECTION_RETRIEVAL_LIMIT), 1),
      MAX_LIMIT,
    );
    const terms = await this.terms(input.query);

    // $1 user, $2 document, $3 section, $4 limit, $5 max content, $6.. terms.
    const params: unknown[] = [
      input.userId,
      input.documentId ?? null,
      input.sectionId ?? null,
      limit,
      MAX_CONTENT_CHARS,
      ...terms,
    ];
    // Inline, not a CTE, so the planner can use the GIN index on `@@`.
    const query = terms.length
      ? `(${terms
          .map((_, i) => `plainto_tsquery('simple', $${i + 6}::text)`)
          .join(' || ')})`
      : 'NULL::tsquery';
    const boundDocument = `COALESCE($2::uuid, (SELECT s0.document_id FROM sections s0 WHERE s0.id = $3::uuid))`;
    const columns = `s.id AS section_id, d.id AS document_id, d.title AS document_title,
                s.title, left(s.content, $5::int) AS content`;

    // (a) Scoped by `d.user_id`, so a binding to someone else's document
    // yields nothing. The bound section first, then matches by rank, then
    // the rest by order.
    const boundRows = await this.dataSource.query<Row[]>(
      `SELECT ${columns},
              true AS in_bound_document,
              COALESCE(s.search_vector @@ ${query}, false) AS matched
       FROM documents d
       JOIN sections s ON s.document_id = d.id
       WHERE d.user_id = $1::uuid AND d.id = ${boundDocument}
       ORDER BY
         COALESCE(s.id = $3::uuid, false) DESC,
         COALESCE(s.search_vector @@ ${query}, false) DESC,
         COALESCE(ts_rank(s.search_vector, ${query}), 0) DESC,
         s."order" ASC, s.id ASC
       LIMIT $4::int`,
      params,
    );

    // (b) Matches elsewhere in the user's documents, by relevance.
    let otherRows: Row[] = [];
    if (terms.length > 0 && boundRows.length < limit) {
      otherRows = await this.dataSource.query<Row[]>(
        `SELECT ${columns},
                false AS in_bound_document,
                true AS matched
         FROM sections s
         JOIN documents d ON d.id = s.document_id
         WHERE d.user_id = $1::uuid
           AND s.search_vector @@ ${query}
           AND d.id IS DISTINCT FROM ${boundDocument}
         ORDER BY ts_rank(s.search_vector, ${query}) DESC, s."order" ASC, s.id ASC
         LIMIT $4::int`,
        params,
      );
    }

    return [...boundRows, ...otherRows].slice(0, limit).map((row) => ({
      sectionId: row.section_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      title: row.title,
      content: row.content,
      inBoundDocument: row.in_bound_document,
      matched: row.matched,
    }));
  }

  /**
   * Distinct lexemes of the text, at most `MAX_QUERY_TERMS`. When there are
   * more, the longer (more distinctive) and more frequent ones win: `simple`
   * has no stop words, so short words are mostly noise.
   */
  private async terms(text: string): Promise<string[]> {
    if (!text.trim()) return [];
    const rows = await this.dataSource.query<Array<{ term: string }>>(
      `SELECT lexeme AS term FROM unnest(to_tsvector('simple', $1::text))
       ORDER BY length(lexeme) DESC, array_length(positions, 1) DESC, lexeme
       LIMIT $2::int`,
      [text, MAX_QUERY_TERMS],
    );
    return rows.map((row) => row.term);
  }
}
