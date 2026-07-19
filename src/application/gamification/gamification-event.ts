/**
 * Normalized shape `HandleGamificationEventUseCase` accepts — a superset of
 * the three documents domain events' payloads (`DocumentCreatedEventPayload`,
 * `SectionCreatedEventPayload`, `SectionUpdatedEventPayload`), since which
 * fields are present depends on which event fired.
 */
export interface GamificationEventPayload {
  userId: string;
  documentId: string;
  sectionId?: string;
  wordCount?: number;
}
