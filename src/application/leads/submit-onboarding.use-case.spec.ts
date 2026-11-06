import { BadRequestException } from '@nestjs/common';
import {
  InMemoryActiveConnectors,
  InMemoryLeadScoreRepository,
  InMemoryLeadSignalRepository,
  InMemoryOnboardingProfileRepository,
  makeSubmitData,
} from '../../../test/utils/leads-fakes';
import { RecalculateLeadScoreUseCase } from './recalculate-lead-score.use-case';
import { SubmitOnboardingUseCase } from './submit-onboarding.use-case';

const DAY_MS = 24 * 60 * 60 * 1000;
const dateOffset = (days: number) =>
  new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

function setup() {
  const profiles = new InMemoryOnboardingProfileRepository();
  const scores = new InMemoryLeadScoreRepository();
  const recalc = new RecalculateLeadScoreUseCase(
    profiles,
    new InMemoryActiveConnectors(),
    new InMemoryLeadSignalRepository(),
    scores,
  );
  return {
    profiles,
    scores,
    useCase: new SubmitOnboardingUseCase(profiles, recalc),
  };
}

describe('SubmitOnboardingUseCase', () => {
  it('stores the answers and the recalculated score before returning', async () => {
    const { profiles, scores, useCase } = setup();

    const result = await useCase.execute(makeSubmitData());

    expect(result.persona).toBe('apprentice');
    expect(await profiles.findByUserId('user-1')).not.toBeNull();
    // Awaited: the score row exists as soon as execute resolves.
    expect(scores.rows.get('user-1')?.score).toBe(4);
  });

  it('rejects a new due date before yesterday and stores nothing', async () => {
    const { profiles, useCase } = setup();

    await expect(
      useCase.execute(makeSubmitData({ dueDate: dateOffset(-2) })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await profiles.findByUserId('user-1')).toBeNull();
  });

  it('accepts yesterday (UTC) as a new due date', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(makeSubmitData({ dueDate: dateOffset(-1) })),
    ).resolves.toBeDefined();
  });

  it('accepts a resubmit that keeps a stored due date which has since passed', async () => {
    const { profiles, useCase } = setup();
    const past = dateOffset(-30);
    await profiles.upsert(makeSubmitData({ dueDate: past }), new Date());

    await expect(
      useCase.execute(makeSubmitData({ dueDate: past, marketingOptIn: false })),
    ).resolves.toMatchObject({ dueDate: past, marketingOptIn: false });
  });

  it('rejects changing a passed due date to another past date', async () => {
    const { profiles, useCase } = setup();
    await profiles.upsert(
      makeSubmitData({ dueDate: dateOffset(-30) }),
      new Date(),
    );

    await expect(
      useCase.execute(makeSubmitData({ dueDate: dateOffset(-20) })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps marketing_opt_in_at when the value is resent unchanged', async () => {
    const { useCase } = setup();
    const first = await useCase.execute(makeSubmitData());
    const second = await useCase.execute(makeSubmitData());
    expect(second.marketingOptInAt).toEqual(first.marketingOptInAt);
  });
});
