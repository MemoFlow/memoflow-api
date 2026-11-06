import {
  AcademicLevel,
  AcquisitionChannel,
  Blocker,
  DeliverableType,
  LeadTier,
  Persona,
  WorkTool,
} from './lead-enums';
import { ScoreBreakdownEntry } from './lead-score';

export const LEAD_READ_REPOSITORY = Symbol('LeadReadRepository');

/**
 * Read model for one eligible lead (role `user`, not disabled): the user joined
 * with its onboarding answers, stored score and behaviour flags. A user with no
 * `lead_scores` row reads as score 0, tier `cold`, `scoreComputedAt: null`.
 */
export interface LeadRow {
  userId: string;
  email: string;
  displayName: string;
  score: number;
  tier: LeadTier;
  breakdown: ScoreBreakdownEntry[];
  scoreComputedAt: Date | null;
  onboardingCompleted: boolean;
  persona: Persona | null;
  deliverableType: DeliverableType | null;
  dueDate: string | null; // YYYY-MM-DD
  academicLevel: AcademicLevel | null;
  workTools: WorkTool[] | null;
  blockers: Blocker[] | null;
  acquisitionChannel: AcquisitionChannel | null;
  marketingOptIn: boolean;
  hasActiveConnector: boolean;
  hasPaywallSignal: boolean;
  registeredAt: Date;
  lastActiveAt: Date | null;
}

export interface LeadListFilter {
  tier?: LeadTier;
  onboardingCompleted?: boolean;
  marketingOptIn?: boolean;
  page: number;
  limit: number;
}

export interface LeadReadRepository {
  /**
   * Eligible leads ordered by stored score desc, then soonest non-past
   * `due_date` (past and null last), then user id asc. `today` is the UTC
   * date (`YYYY-MM-DD`) used to decide whether a due date has passed.
   */
  list(
    filter: LeadListFilter,
    today: string,
  ): Promise<{ rows: LeadRow[]; total: number }>;
  findEligibleByUserId(userId: string): Promise<LeadRow | null>;
  findAllEligible(): Promise<LeadRow[]>;
}
