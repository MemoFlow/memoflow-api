import * as Sentry from '@sentry/nestjs';
import { RecalculateLeadScoreUseCase } from '../../application/leads/recalculate-lead-score.use-case';
import { LeadScoreListener } from './lead-score.listener';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

function makeListener() {
  const useCase = { execute: jest.fn() };
  const listener = new LeadScoreListener(
    useCase as unknown as RecalculateLeadScoreUseCase,
  );
  return { useCase, listener };
}

describe('LeadScoreListener', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recalculates the owner on connector.status_changed', async () => {
    const { useCase, listener } = makeListener();
    useCase.execute.mockResolvedValue(undefined);

    await listener.onConnectorStatusChanged({ userId: 'user-1' });

    expect(useCase.execute).toHaveBeenCalledWith('user-1');
  });

  it('recalculates the owner on the existing connector revoked event', async () => {
    const { useCase, listener } = makeListener();
    useCase.execute.mockResolvedValue(undefined);

    await listener.onConnectorRevoked({ userId: 'user-2' });

    expect(useCase.execute).toHaveBeenCalledWith('user-2');
  });

  it('swallows a failure and reports it to Sentry', async () => {
    const { useCase, listener } = makeListener();
    const error = new Error('db exploded');
    useCase.execute.mockRejectedValue(error);

    await expect(
      listener.onConnectorStatusChanged({ userId: 'user-1' }),
    ).resolves.toBeUndefined();
    await expect(
      listener.onConnectorRevoked({ userId: 'user-1' }),
    ).resolves.toBeUndefined();

    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
