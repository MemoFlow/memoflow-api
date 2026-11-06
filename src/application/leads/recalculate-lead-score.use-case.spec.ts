import {
  LeadSignalType,
  LeadTier,
  ScoreRule,
} from '../../domain/leads/lead-enums';
import {
  InMemoryActiveConnectors,
  InMemoryLeadScoreRepository,
  InMemoryLeadSignalRepository,
  InMemoryOnboardingProfileRepository,
  makeSubmitData,
} from '../../../test/utils/leads-fakes';
import { RecalculateLeadScoreUseCase } from './recalculate-lead-score.use-case';

function setup() {
  const profiles = new InMemoryOnboardingProfileRepository();
  const connectors = new InMemoryActiveConnectors();
  const signals = new InMemoryLeadSignalRepository();
  const scores = new InMemoryLeadScoreRepository();
  const useCase = new RecalculateLeadScoreUseCase(
    profiles,
    connectors,
    signals,
    scores,
  );
  return { profiles, connectors, signals, scores, useCase };
}

describe('RecalculateLeadScoreUseCase', () => {
  it('stores a zero cold score for a user with no facts', async () => {
    const { scores, useCase } = setup();

    await useCase.execute('user-1');

    expect(scores.rows.get('user-1')).toMatchObject({
      score: 0,
      tier: LeadTier.Cold,
      breakdown: [],
    });
  });

  it('scores onboarding answers, a connector and a paywall signal', async () => {
    const { profiles, connectors, signals, scores, useCase } = setup();
    const now = new Date();
    // Far-future due date scores nothing: persona 2 + trello 2.
    await profiles.upsert(makeSubmitData(), now);
    await useCase.execute('user-1');
    expect(scores.rows.get('user-1')?.score).toBe(4);
    expect(scores.rows.get('user-1')?.tier).toBe(LeadTier.Warm);

    connectors.active.add('user-1');
    await signals.record('user-1', LeadSignalType.ExportPaywallHit, now);
    await useCase.execute('user-1');

    const stored = scores.rows.get('user-1');
    expect(stored?.score).toBe(10);
    expect(stored?.tier).toBe(LeadTier.Hot);
    expect(stored?.breakdown.map((b) => b.rule)).toEqual(
      expect.arrayContaining([
        ScoreRule.ConnectedTool,
        ScoreRule.ExportPaywallHit,
      ]),
    );
  });

  it('drops the connected_tool points when the connector is no longer active', async () => {
    const { connectors, scores, useCase } = setup();
    connectors.active.add('user-1');
    await useCase.execute('user-1');
    expect(scores.rows.get('user-1')?.score).toBe(3);

    connectors.active.delete('user-1');
    await useCase.execute('user-1');
    expect(scores.rows.get('user-1')?.score).toBe(0);
  });
});
