/**
 * Domain event contracts emitted by the documents feature's use-cases
 * (`CreateDocumentUseCase`, `CreateSectionUseCase`, `UpdateSectionUseCase`)
 * after a write successfully persists. Consumed today by the gamification
 * feature's `GamificationListener` (roadmap item 6), via `EventEmitter2` —
 * plain TypeScript here, no framework imports, so this stays valid domain-layer
 * content that any application layer (own feature or another's, e.g.
 * `application/gamification`) can depend on per the clean-architecture rule
 * "application depends on domain only".
 */

export const DOCUMENT_CREATED_EVENT = 'document.created';
export const SECTION_CREATED_EVENT = 'section.created';
export const SECTION_UPDATED_EVENT = 'section.updated';

export interface DocumentCreatedEventPayload {
  userId: string;
  documentId: string;
}

export interface SectionCreatedEventPayload {
  userId: string;
  documentId: string;
  sectionId: string;
}

export interface SectionUpdatedEventPayload {
  userId: string;
  documentId: string;
  sectionId: string;
  wordCount: number;
}
