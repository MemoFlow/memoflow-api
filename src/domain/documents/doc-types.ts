/**
 * Controlled vocabulary for `documents.doc_type` and `templates.doc_type`
 * (varchar columns; the allowed set is enforced at the API boundary and in
 * use-cases, not by a DB constraint, so adding a type needs no migration).
 */
export const DOC_TYPES = [
  'blog',
  'planning',
  'report',
  'thesis',
  'internship_report',
] as const;

export type DocType = (typeof DOC_TYPES)[number];
