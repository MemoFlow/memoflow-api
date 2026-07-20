import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RecordAuditEventUseCase } from '../../application/audit/record-audit-event.use-case';
import {
  AUTH_LOGIN_EVENT,
  AUTH_LOGIN_FAILED_EVENT,
  CONNECTOR_REVOKED_EVENT,
  SUGGESTION_REVIEWED_EVENT,
} from '../../domain/audit/audit-events';
import type {
  AuthLoginEventPayload,
  AuthLoginFailedEventPayload,
  ConnectorRevokedEventPayload,
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
