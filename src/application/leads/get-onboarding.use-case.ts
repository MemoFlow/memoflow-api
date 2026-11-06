import { Inject, Injectable } from '@nestjs/common';
import { OnboardingProfile } from '../../domain/leads/onboarding-profile.entity';
import { ONBOARDING_PROFILE_REPOSITORY } from '../../domain/leads/onboarding-profile.repository';
import type { OnboardingProfileRepository } from '../../domain/leads/onboarding-profile.repository';

@Injectable()
export class GetOnboardingUseCase {
  constructor(
    @Inject(ONBOARDING_PROFILE_REPOSITORY)
    private readonly profiles: OnboardingProfileRepository,
  ) {}

  /** Null when the user has not submitted yet (never an error). */
  execute(userId: string): Promise<OnboardingProfile | null> {
    return this.profiles.findByUserId(userId);
  }
}
