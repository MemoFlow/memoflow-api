import { LeadSignalType } from '../../domain/leads/lead-enums';
import { UserRole } from '../../domain/users/user-role';
import {
  InMemoryActiveConnectors,
  InMemoryLeadScoreRepository,
  InMemoryLeadSignalRepository,
  InMemoryOnboardingProfileRepository,
} from '../../../test/utils/leads-fakes';
import { RecalculateLeadScoreUseCase } from './recalculate-lead-score.use-case';
import { RecordLeadSignalUseCase } from './record-lead-signal.use-case';

function setup() {
  const signals = new InMemoryLeadSignalRepository();
  const scores = new InMemoryLeadScoreRepository();
  const recalc = new RecalculateLeadScoreUseCase(
    new InMemoryOnboardingProfileRepository(),
    new InMemoryActiveConnectors(),
    signals,
    scores,
  );
  return {
    signals,
    scores,
    useCase: new RecordLeadSignalUseCase(signals, recalc),
  };
}

const input = (role: UserRole) => ({
  userId: 'user-1',
  role,
  type: LeadSignalType.ExportPaywallHit,
});

describe('RecordLeadSignalUseCase', () => {
  it('records the signal and has recalculated the score when it resolves', async () => {
    const { signals, scores, useCase } = setup();

    await useCase.execute(input(UserRole.User));

    expect(signals.rows).toHaveLength(1);
    expect(scores.rows.get('user-1')?.score).toBe(3);
  });

  it('repeating the signal bumps occurrences but scores once', async () => {
    const { signals, scores, useCase } = setup();

    await useCase.execute(input(UserRole.User));
    await useCase.execute(input(UserRole.User));

    expect(signals.rows).toHaveLength(1);
    expect(signals.rows[0].occurrences).toBe(2);
    expect(scores.rows.get('user-1')?.score).toBe(3);
  });

  it('ignores admin callers: nothing stored, nothing scored', async () => {
    const { signals, scores, useCase } = setup();

    await useCase.execute(input(UserRole.Admin));

    expect(signals.rows).toHaveLength(0);
    expect(scores.rows.size).toBe(0);
  });
});
