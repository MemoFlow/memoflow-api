import { Prompt } from './prompt.entity';

export const PROMPT_REPOSITORY = Symbol('PromptRepository');

export interface PromptRepository {
  /**
   * The single active prompt for a feature type (e.g. 'suggestion',
   * 'planning'), or `null` if none is configured/active. Seeded by
   * `scripts/seed.ts`; no write path is exposed via the API in this branch.
   */
  findActiveByFeatureType(featureType: string): Promise<Prompt | null>;
}
