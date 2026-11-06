import { Prompt } from './prompt.entity';

export const PROMPT_REPOSITORY = Symbol('PromptRepository');

export interface CreatePromptData {
  featureType: string;
  version: string;
  systemTemplate: string;
  /** The user-message template (`prompts.template`). */
  template: string;
  userInvocable: boolean;
}

/** `(feature_type, version)` already exists. */
export class PromptVersionConflictError extends Error {
  constructor() {
    super('A prompt with this feature type and version already exists');
    this.name = 'PromptVersionConflictError';
  }
}

/** A concurrent activation won the one-active-per-feature-type race. */
export class PromptActivationConflictError extends Error {
  constructor() {
    super('Another prompt was activated concurrently; retry');
    this.name = 'PromptActivationConflictError';
  }
}

export interface PromptRepository {
  /**
   * The single active prompt for a feature type (e.g. 'suggestion',
   * 'planning'), or `null` if none is active.
   */
  findActiveByFeatureType(featureType: string): Promise<Prompt | null>;

  findById(id: string): Promise<Prompt | null>;

  /** Newest first; optionally limited to one feature type. */
  list(featureType?: string): Promise<Prompt[]>;

  /**
   * Creates an INACTIVE prompt. Throws `PromptVersionConflictError` on a
   * duplicate `(feature_type, version)`.
   */
  create(data: CreatePromptData): Promise<Prompt>;

  /**
   * In one transaction: deactivates the feature type's active prompt, then
   * activates `id`. Returns `null` if `id` doesn't exist. Throws
   * `PromptActivationConflictError` when a concurrent activation violates the
   * one-active-per-feature-type unique index.
   */
  activate(id: string): Promise<Prompt | null>;
}
