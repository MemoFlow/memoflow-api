import {
  AcademicLevel,
  AcquisitionChannel,
  Blocker,
  DeliverableType,
  Persona,
  WorkTool,
} from './lead-enums';
import { OnboardingProfile } from './onboarding-profile.entity';

export const ONBOARDING_PROFILE_REPOSITORY = Symbol(
  'OnboardingProfileRepository',
);

export interface SubmitOnboardingData {
  userId: string;
  persona: Persona;
  deliverableType: DeliverableType;
  dueDate: string; // YYYY-MM-DD
  academicLevel: AcademicLevel;
  schoolName: string | null;
  workTools: WorkTool[];
  blockers: Blocker[];
  acquisitionChannel: AcquisitionChannel;
  marketingOptIn: boolean;
}

export interface OnboardingProfileRepository {
  findByUserId(userId: string): Promise<OnboardingProfile | null>;
  /**
   * Inserts or replaces the user's answers. `marketing_opt_in_at` is set on
   * the first insert and afterwards only when `marketing_opt_in` changes —
   * enforced in SQL.
   */
  upsert(data: SubmitOnboardingData, now: Date): Promise<OnboardingProfile>;
  /** Same opt-in timestamp rule as `upsert`. Null when the user has no row. */
  updateConsent(
    userId: string,
    optIn: boolean,
    now: Date,
  ): Promise<OnboardingProfile | null>;
}
