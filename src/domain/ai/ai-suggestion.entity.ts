/**
 * Domain entity for `ai_suggestions` (see docs/database-schema.md). Plain
 * TypeScript — no typeorm imports.
 */
export enum SuggestionStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected',
}

export class AiSuggestion {
  id: string;
  sectionId: string;
  userId: string;
  featureType: string;
  originalText: string;
  suggestedText: string;
  status: SuggestionStatus;
  promptVersion: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: {
    id: string;
    sectionId: string;
    userId: string;
    featureType: string;
    originalText: string;
    suggestedText: string;
    status: SuggestionStatus;
    promptVersion: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = props.id;
    this.sectionId = props.sectionId;
    this.userId = props.userId;
    this.featureType = props.featureType;
    this.originalText = props.originalText;
    this.suggestedText = props.suggestedText;
    this.status = props.status;
    this.promptVersion = props.promptVersion;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
