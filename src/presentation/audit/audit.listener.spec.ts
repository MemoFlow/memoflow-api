import {
  AUTH_LOGIN_EVENT,
  AUTH_LOGIN_FAILED_EVENT,
  CONNECTOR_REVOKED_EVENT,
  SUGGESTION_REVIEWED_EVENT,
} from '../../domain/audit/audit-events';
import { RecordAuditEventUseCase } from '../../application/audit/record-audit-event.use-case';
import { AuditListener } from './audit.listener';

function makeUseCase(): jest.Mocked<Pick<RecordAuditEventUseCase, 'execute'>> {
  return { execute: jest.fn() };
}

describe('AuditListener', () => {
  it('maps auth.login to the right action/userId with no metadata', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue(undefined as never);
    const listener = new AuditListener(
      useCase as unknown as RecordAuditEventUseCase,
    );

    await listener.onAuthLogin({ userId: 'user-1' });

    expect(useCase.execute).toHaveBeenCalledWith({
      action: AUTH_LOGIN_EVENT,
      userId: 'user-1',
      metadata: null,
      ip: null,
    });
  });

  it('maps auth.login_failed to the right action/metadata, including a null userId for an unknown email', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue(undefined as never);
    const listener = new AuditListener(
      useCase as unknown as RecordAuditEventUseCase,
    );

    await listener.onAuthLoginFailed({
      userId: null,
      email: 'nobody@example.com',
    });

    expect(useCase.execute).toHaveBeenCalledWith({
      action: AUTH_LOGIN_FAILED_EVENT,
      userId: null,
      metadata: { email: 'nobody@example.com' },
      ip: null,
    });
  });

  it('maps connector.revoked to the right action/metadata', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue(undefined as never);
    const listener = new AuditListener(
      useCase as unknown as RecordAuditEventUseCase,
    );

    await listener.onConnectorRevoked({
      userId: 'user-1',
      connectionId: 'conn-1',
      provider: 'trello',
    });

    expect(useCase.execute).toHaveBeenCalledWith({
      action: CONNECTOR_REVOKED_EVENT,
      userId: 'user-1',
      metadata: { connectionId: 'conn-1', provider: 'trello' },
      ip: null,
    });
  });

  it('maps suggestion.reviewed to the right action/metadata', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue(undefined as never);
    const listener = new AuditListener(
      useCase as unknown as RecordAuditEventUseCase,
    );

    await listener.onSuggestionReviewed({
      userId: 'user-1',
      suggestionId: 'suggestion-1',
      decision: 'accepted',
    });

    expect(useCase.execute).toHaveBeenCalledWith({
      action: SUGGESTION_REVIEWED_EVENT,
      userId: 'user-1',
      metadata: { suggestionId: 'suggestion-1', decision: 'accepted' },
      ip: null,
    });
  });

  it('swallows a use-case failure instead of letting it propagate', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockRejectedValue(new Error('db exploded'));
    const listener = new AuditListener(
      useCase as unknown as RecordAuditEventUseCase,
    );

    await expect(
      listener.onAuthLogin({ userId: 'user-1' }),
    ).resolves.toBeUndefined();
  });
});
