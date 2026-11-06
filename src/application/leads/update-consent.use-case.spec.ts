import { ConflictException } from '@nestjs/common';
import {
  InMemoryOnboardingProfileRepository,
  makeSubmitData,
} from '../../../test/utils/leads-fakes';
import { UpdateConsentUseCase } from './update-consent.use-case';

describe('UpdateConsentUseCase', () => {
  it('throws Conflict before the first submit', async () => {
    const useCase = new UpdateConsentUseCase(
      new InMemoryOnboardingProfileRepository(),
    );
    await expect(useCase.execute('user-1', false)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('withdraws consent and moves the timestamp only when the value changes', async () => {
    const profiles = new InMemoryOnboardingProfileRepository();
    const t0 = new Date('2026-01-01T00:00:00Z');
    await profiles.upsert(makeSubmitData({ marketingOptIn: true }), t0);
    const useCase = new UpdateConsentUseCase(profiles);

    const same = await useCase.execute('user-1', true);
    expect(same.marketingOptInAt).toEqual(t0);

    const withdrawn = await useCase.execute('user-1', false);
    expect(withdrawn.marketingOptIn).toBe(false);
    expect(withdrawn.marketingOptInAt.getTime()).toBeGreaterThan(t0.getTime());
  });

  it('succeeds for a profile whose due date has passed', async () => {
    const profiles = new InMemoryOnboardingProfileRepository();
    await profiles.upsert(
      makeSubmitData({ dueDate: '2020-01-01' }),
      new Date(),
    );
    const useCase = new UpdateConsentUseCase(profiles);
    await expect(useCase.execute('user-1', false)).resolves.toMatchObject({
      marketingOptIn: false,
    });
  });
});
