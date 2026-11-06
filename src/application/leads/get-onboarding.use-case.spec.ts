import { GetOnboardingUseCase } from './get-onboarding.use-case';
import {
  InMemoryOnboardingProfileRepository,
  makeSubmitData,
} from '../../../test/utils/leads-fakes';

describe('GetOnboardingUseCase', () => {
  it('returns null (not an error) when nothing was submitted', async () => {
    const useCase = new GetOnboardingUseCase(
      new InMemoryOnboardingProfileRepository(),
    );
    await expect(useCase.execute('user-1')).resolves.toBeNull();
  });

  it('returns the stored profile', async () => {
    const profiles = new InMemoryOnboardingProfileRepository();
    await profiles.upsert(makeSubmitData(), new Date());
    const useCase = new GetOnboardingUseCase(profiles);
    await expect(useCase.execute('user-1')).resolves.toMatchObject({
      userId: 'user-1',
    });
  });
});
