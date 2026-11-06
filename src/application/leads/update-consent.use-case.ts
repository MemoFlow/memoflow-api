import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { OnboardingProfile } from '../../domain/leads/onboarding-profile.entity';
import { ONBOARDING_PROFILE_REPOSITORY } from '../../domain/leads/onboarding-profile.repository';
import type { OnboardingProfileRepository } from '../../domain/leads/onboarding-profile.repository';

@Injectable()
export class UpdateConsentUseCase {
  constructor(
    @Inject(ONBOARDING_PROFILE_REPOSITORY)
    private readonly profiles: OnboardingProfileRepository,
  ) {}

  /** Does not recalculate: consent never changes the stored score. */
  async execute(userId: string, optIn: boolean): Promise<OnboardingProfile> {
    const profile = await this.profiles.updateConsent(
      userId,
      optIn,
      new Date(),
    );
    if (!profile) {
      throw new ConflictException(
        'Submit onboarding before changing marketing consent',
      );
    }
    return profile;
  }
}
