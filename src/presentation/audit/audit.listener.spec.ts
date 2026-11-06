import {
  AUTH_LOGIN_EVENT,
  AUTH_LOGIN_FAILED_EVENT,
  AUTH_LOGIN_THROTTLED_EVENT,
  AUTH_LOGOUT_EVENT,
  CONNECTOR_REVOKED_EVENT,
  PROMPT_ACTIVATED_EVENT,
  PROMPT_CREATED_EVENT,
  SUGGESTION_REVIEWED_EVENT,
  TEMPLATE_CREATED_EVENT,
  TEMPLATE_DELETED_EVENT,
  TEMPLATE_PUBLISHED_EVENT,
  TEMPLATE_UNPUBLISHED_EVENT,
  TEMPLATE_UPDATED_EVENT,
} from '../../domain/audit/audit-events';
import {
  USER_DISABLED_EVENT,
  USER_ENABLED_EVENT,
} from '../../domain/users/user-events';
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

  it('maps auth.logout to the right action/userId with no metadata', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue(undefined as never);
    const listener = new AuditListener(
      useCase as unknown as RecordAuditEventUseCase,
    );

    await listener.onAuthLogout({ userId: 'user-1' });

    expect(useCase.execute).toHaveBeenCalledWith({
      action: AUTH_LOGOUT_EVENT,
      userId: 'user-1',
      metadata: null,
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

  it.each([
    ['onPromptCreated', PROMPT_CREATED_EVENT],
    ['onPromptActivated', PROMPT_ACTIVATED_EVENT],
  ] as const)(
    '%s records the acting admin and the prompt',
    async (method, action) => {
      const useCase = makeUseCase();
      useCase.execute.mockResolvedValue(undefined as never);
      const listener = new AuditListener(
        useCase as unknown as RecordAuditEventUseCase,
      );

      await listener[method]({
        userId: 'admin-1',
        promptId: 'p-1',
        featureType: 'suggestion',
        version: 'v3',
      });

      expect(useCase.execute).toHaveBeenCalledWith({
        action,
        userId: 'admin-1',
        metadata: { promptId: 'p-1', featureType: 'suggestion', version: 'v3' },
        ip: null,
      });
    },
  );

  it.each([
    ['onTemplateCreated', TEMPLATE_CREATED_EVENT],
    ['onTemplateUpdated', TEMPLATE_UPDATED_EVENT],
    ['onTemplatePublished', TEMPLATE_PUBLISHED_EVENT],
    ['onTemplateUnpublished', TEMPLATE_UNPUBLISHED_EVENT],
    ['onTemplateDeleted', TEMPLATE_DELETED_EVENT],
  ] as const)(
    '%s records the acting user and template id',
    async (method, action) => {
      const useCase = makeUseCase();
      useCase.execute.mockResolvedValue(undefined as never);
      const listener = new AuditListener(
        useCase as unknown as RecordAuditEventUseCase,
      );

      await listener[method]({ userId: 'user-1', templateId: 't-1' });

      expect(useCase.execute).toHaveBeenCalledWith({
        action,
        userId: 'user-1',
        metadata: { templateId: 't-1' },
        ip: null,
      });
    },
  );

  it('includes changedFields (names only) on template.updated', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue(undefined as never);
    const listener = new AuditListener(
      useCase as unknown as RecordAuditEventUseCase,
    );

    await listener.onTemplateUpdated({
      userId: 'user-1',
      templateId: 't-1',
      changedFields: ['title', 'sections'],
    });

    expect(useCase.execute).toHaveBeenCalledWith({
      action: TEMPLATE_UPDATED_EVENT,
      userId: 'user-1',
      metadata: { templateId: 't-1', changedFields: ['title', 'sections'] },
      ip: null,
    });
  });

  it.each([
    ['onUserDisabled', USER_DISABLED_EVENT],
    ['onUserEnabled', USER_ENABLED_EVENT],
  ] as const)(
    '%s records the acting admin and the target user',
    async (method, action) => {
      const useCase = makeUseCase();
      useCase.execute.mockResolvedValue(undefined as never);
      const listener = new AuditListener(
        useCase as unknown as RecordAuditEventUseCase,
      );

      await listener[method]({ userId: 'target-1', actorId: 'admin-1' });

      expect(useCase.execute).toHaveBeenCalledWith({
        action,
        userId: 'admin-1',
        metadata: { targetUserId: 'target-1' },
        ip: null,
      });
    },
  );

  it('maps auth.login_throttled with a null userId and the email', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue(undefined as never);
    const listener = new AuditListener(
      useCase as unknown as RecordAuditEventUseCase,
    );

    await listener.onAuthLoginThrottled({ userId: null, email: 'a@b.com' });

    expect(useCase.execute).toHaveBeenCalledWith({
      action: AUTH_LOGIN_THROTTLED_EVENT,
      userId: null,
      metadata: { email: 'a@b.com' },
      ip: null,
    });
  });
});
