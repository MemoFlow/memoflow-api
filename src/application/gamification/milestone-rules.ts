import {
  DOCUMENT_CREATED_EVENT,
  SECTION_CREATED_EVENT,
  SECTION_UPDATED_EVENT,
} from '../../domain/documents/document-events';
import { GamificationEventPayload } from './gamification-event';

/** `section_goal` milestone fires once a section reaches this word count. */
export const SECTION_GOAL_WORD_COUNT = 100;

export interface MilestoneRule {
  event: string;
  milestoneType: string;
  xp: number;
  /** Extra guard beyond matching `event` (e.g. a word-count threshold). */
  condition?: (payload: GamificationEventPayload) => boolean;
}

/**
 * Milestone rules table — each entry maps a documents domain event to a
 * `milestones.milestone_type` + XP award. `milestones` has one unique row
 * per (user, document, milestone_type), so each rule can only ever award
 * once per document regardless of how many times its event fires for that
 * document (e.g. `section_created` only awards `first_section` once per
 * document, even though a document can have many sections).
 */
export const MILESTONE_RULES: MilestoneRule[] = [
  { event: DOCUMENT_CREATED_EVENT, milestoneType: 'document_created', xp: 50 },
  { event: SECTION_CREATED_EVENT, milestoneType: 'first_section', xp: 25 },
  {
    event: SECTION_UPDATED_EVENT,
    milestoneType: 'section_goal',
    xp: 25,
    condition: (payload) => (payload.wordCount ?? 0) >= SECTION_GOAL_WORD_COUNT,
  },
];
