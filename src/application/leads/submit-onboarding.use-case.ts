import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { toUtcDate } from '../../domain/leads/lead-score';
import { OnboardingProfile } from '../../domain/leads/onboarding-profile.entity';
import { ONBOARDING_PROFILE_REPOSITORY } from '../../domain/leads/onboarding-profile.repository';
import type {
  OnboardingProfileRepository,
  SubmitOnboardingData,
} from '../../domain/leads/onboarding-profile.repository';
import { RecalculateLeadScoreUseCase } from './recalculate-lead-score.use-case';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SubmitOnboardingUseCase {
  constructor(
    @Inject(ONBOARDING_PROFILE_REPOSITORY)
    private readonly profiles: OnboardingProfileRepository,
    private readonly recalculate: RecalculateLeadScoreUseCase,
  ) {}

  async execute(data: SubmitOnboardingData): Promise<OnboardingProfile> {
    const now = new Date();
    const existing = await this.profiles.findByUserId(data.userId);
    // A resubmit that keeps the stored due date stays valid after it passes.
    // Any other date may not be before yesterday (UTC), which allows for
    // time zones.
    if (existing?.dueDate !== data.dueDate) {
      const yesterday = toUtcDate(new Date(now.getTime() - DAY_MS));
      if (data.dueDate < yesterday) {
        throw new BadRequestException('due_date must not be in the past');
      }
    }
    const profile = await this.profiles.upsert(data, now);
    await this.recalculate.execute(data.userId);
    return profile;
  }
}
