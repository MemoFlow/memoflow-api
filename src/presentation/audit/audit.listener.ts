import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RecordAuditEventUseCase } from '../../application/audit/record-audit-event.use-case';
import {
  AUTH_EMAIL_VERIFIED_EVENT,
  AUTH_LOGIN_EVENT,
  AUTH_LOGIN_FAILED_EVENT,
  AUTH_LOGIN_THROTTLED_EVENT,
  AUTH_LOGOUT_EVENT,
  AUTH_PASSWORD_CHANGED_EVENT,
  AUTH_PASSWORD_RESET_COMPLETED_EVENT,
  AUTH_PASSWORD_RESET_REQUESTED_EVENT,
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
import type {
  UserDisabledEventPayload,
  UserEnabledEventPayload,
} from '../../domain/users/user-events';
import type {
  AuthAccountEventPayload,
  AuthLoginEventPayload,
  AuthLoginFailedEventPayload,
  AuthLoginThrottledEventPayload,
  TemplateAuditEventPayload,
  ConnectorRevokedEventPayload,
  PromptAuditEventPayload,
  SuggestionReviewedEventPayload,
} from '../../domain/audit/audit-events';

/**
 * Subscribes to security-relevant domain events emitted across features
 * (auth, connectors, ai) and persists each as an `audit_logs` row via
 * `RecordAuditEventUseCase`. Mirrors `GamificationListener` exactly: this is
 * the ONLY place these events are consumed, and the ONLY place their errors
 * are swallowed — a failed audit write (e.g. a transient DB error) must
 * never fail the request that emitted the originating event.
 * `EventEmitter2.emit()` is fire-and-forget and doesn't await this handler,
 * so an uncaught rejection here would only ever surface as an unhandled
 * rejection, not a failed request; catching it here turns that into a clean
 * log line instead.
 *
 * The audit log is a write-only internal sink — there is no
 * `src/presentation/audit/` controller, and `AuditLog` is never serialized
 * into any API response.
 *
 * `ip` is not yet threaded through from the originating HTTP request into
 * these events (would require changing use-case input signatures beyond
 * "emit an event", out of scope for this slice) — every row records
 * `ip: null` for now. `audit_logs.ip` stays nullable to allow this.
 */
@Injectable()
export class AuditListener {
  private readonly logger = new Logger(AuditListener.name);

  constructor(private readonly recordAuditEvent: RecordAuditEventUseCase) {}

  @OnEvent(AUTH_LOGIN_EVENT)
  async onAuthLogin(payload: AuthLoginEventPayload): Promise<void> {
    await this.safeRecord(AUTH_LOGIN_EVENT, payload.userId, null);
  }

  @OnEvent(AUTH_LOGIN_FAILED_EVENT)
  async onAuthLoginFailed(payload: AuthLoginFailedEventPayload): Promise<void> {
    await this.safeRecord(AUTH_LOGIN_FAILED_EVENT, payload.userId, {
      email: payload.email,
    });
  }

  @OnEvent(AUTH_LOGIN_THROTTLED_EVENT)
  async onAuthLoginThrottled(
    payload: AuthLoginThrottledEventPayload,
  ): Promise<void> {
    await this.safeRecord(AUTH_LOGIN_THROTTLED_EVENT, payload.userId, {
      email: payload.email,
    });
  }

  @OnEvent(AUTH_LOGOUT_EVENT)
  async onAuthLogout(payload: AuthAccountEventPayload): Promise<void> {
    await this.safeRecord(AUTH_LOGOUT_EVENT, payload.userId, null);
  }

  @OnEvent(AUTH_PASSWORD_RESET_REQUESTED_EVENT)
  async onPasswordResetRequested(
    payload: AuthAccountEventPayload,
  ): Promise<void> {
    await this.safeRecord(
      AUTH_PASSWORD_RESET_REQUESTED_EVENT,
      payload.userId,
      null,
    );
  }

  @OnEvent(AUTH_PASSWORD_RESET_COMPLETED_EVENT)
  async onPasswordResetCompleted(
    payload: AuthAccountEventPayload,
  ): Promise<void> {
    await this.safeRecord(
      AUTH_PASSWORD_RESET_COMPLETED_EVENT,
      payload.userId,
      null,
    );
  }

  @OnEvent(AUTH_PASSWORD_CHANGED_EVENT)
  async onPasswordChanged(payload: AuthAccountEventPayload): Promise<void> {
    await this.safeRecord(AUTH_PASSWORD_CHANGED_EVENT, payload.userId, null);
  }

  @OnEvent(AUTH_EMAIL_VERIFIED_EVENT)
  async onEmailVerified(payload: AuthAccountEventPayload): Promise<void> {
    await this.safeRecord(AUTH_EMAIL_VERIFIED_EVENT, payload.userId, null);
  }

  @OnEvent(CONNECTOR_REVOKED_EVENT)
  async onConnectorRevoked(
    payload: ConnectorRevokedEventPayload,
  ): Promise<void> {
    await this.safeRecord(CONNECTOR_REVOKED_EVENT, payload.userId, {
      connectionId: payload.connectionId,
      provider: payload.provider,
    });
  }

  @OnEvent(SUGGESTION_REVIEWED_EVENT)
  async onSuggestionReviewed(
    payload: SuggestionReviewedEventPayload,
  ): Promise<void> {
    await this.safeRecord(SUGGESTION_REVIEWED_EVENT, payload.userId, {
      suggestionId: payload.suggestionId,
      decision: payload.decision,
    });
  }

  @OnEvent(PROMPT_CREATED_EVENT)
  async onPromptCreated(payload: PromptAuditEventPayload): Promise<void> {
    await this.safeRecord(PROMPT_CREATED_EVENT, payload.userId, {
      promptId: payload.promptId,
      featureType: payload.featureType,
      version: payload.version,
    });
  }

  @OnEvent(PROMPT_ACTIVATED_EVENT)
  async onPromptActivated(payload: PromptAuditEventPayload): Promise<void> {
    await this.safeRecord(PROMPT_ACTIVATED_EVENT, payload.userId, {
      promptId: payload.promptId,
      featureType: payload.featureType,
      version: payload.version,
    });
  }

  @OnEvent(TEMPLATE_CREATED_EVENT)
  async onTemplateCreated(payload: TemplateAuditEventPayload): Promise<void> {
    await this.recordTemplate(TEMPLATE_CREATED_EVENT, payload);
  }

  @OnEvent(TEMPLATE_UPDATED_EVENT)
  async onTemplateUpdated(payload: TemplateAuditEventPayload): Promise<void> {
    await this.recordTemplate(TEMPLATE_UPDATED_EVENT, payload);
  }

  @OnEvent(TEMPLATE_PUBLISHED_EVENT)
  async onTemplatePublished(payload: TemplateAuditEventPayload): Promise<void> {
    await this.recordTemplate(TEMPLATE_PUBLISHED_EVENT, payload);
  }

  @OnEvent(TEMPLATE_UNPUBLISHED_EVENT)
  async onTemplateUnpublished(
    payload: TemplateAuditEventPayload,
  ): Promise<void> {
    await this.recordTemplate(TEMPLATE_UNPUBLISHED_EVENT, payload);
  }

  @OnEvent(TEMPLATE_DELETED_EVENT)
  async onTemplateDeleted(payload: TemplateAuditEventPayload): Promise<void> {
    await this.recordTemplate(TEMPLATE_DELETED_EVENT, payload);
  }

  /** The acting admin is the audit row's user; the target is in metadata. */
  @OnEvent(USER_DISABLED_EVENT)
  async onUserDisabled(payload: UserDisabledEventPayload): Promise<void> {
    await this.safeRecord(USER_DISABLED_EVENT, payload.actorId, {
      targetUserId: payload.userId,
    });
  }

  @OnEvent(USER_ENABLED_EVENT)
  async onUserEnabled(payload: UserEnabledEventPayload): Promise<void> {
    await this.safeRecord(USER_ENABLED_EVENT, payload.actorId, {
      targetUserId: payload.userId,
    });
  }

  private async recordTemplate(
    action: string,
    payload: TemplateAuditEventPayload,
  ): Promise<void> {
    await this.safeRecord(action, payload.userId, {
      templateId: payload.templateId,
      ...(payload.changedFields
        ? { changedFields: payload.changedFields }
        : {}),
    });
  }

  private async safeRecord(
    action: string,
    userId: string | null,
    metadata: Record<string, unknown> | null,
  ): Promise<void> {
    try {
      await this.recordAuditEvent.execute({
        action,
        userId,
        metadata,
        ip: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(
        `Audit logging failed for '${action}' (userId=${userId ?? 'unknown'}): ${message}`,
      );
    }
  }
}
