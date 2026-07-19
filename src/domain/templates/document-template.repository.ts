import { DocumentTemplate } from './document-template.entity';

export const DOCUMENT_TEMPLATE_REPOSITORY = Symbol(
  'DocumentTemplateRepository',
);

export interface ApplyTemplateSectionData {
  title: string;
  content: string;
  status: string;
  wordCount: number;
}

export interface ApplyToDocumentData {
  documentId: string;
  templateId: string;
  appliedAt: Date;
  /**
   * Ordered — the repository assigns sequential `order` values starting
   * after the document's current max section order, computed inside the
   * same transaction as the inserts below (closing the race between
   * reading that max and appending).
   */
  sections: ApplyTemplateSectionData[];
}

export interface ApplyToDocumentResult {
  documentTemplate: DocumentTemplate;
  sectionsCreated: number;
}

export interface DocumentTemplateRepository {
  /**
   * Atomically appends one document section per entry in `data.sections`
   * and records the `document_templates` row in a single transaction, so a
   * failure partway through can't orphan sections without a recorded
   * application (or vice versa).
   */
  applyToDocument(data: ApplyToDocumentData): Promise<ApplyToDocumentResult>;
}
