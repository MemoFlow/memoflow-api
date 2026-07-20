/**
 * Domain event contracts for security-relevant actions across features
 * (auth, connectors, ai) — security-hardening plan, slice 5 (audit log).
 * Consumed by the single `AuditListener` (presentation layer) via
 * `EventEmitter2` and persisted as `audit_logs` rows through
 * `RecordAuditEventUseCase`. Plain TypeScript here, no framework imports —
 * same convention as `document-events.ts`: any application layer (own
 * feature or another's, e.g. `application/auth`, `application/connectors`,
 * `application/ai`) can depend on this domain-layer content per the
 * clean-architecture rule "application depends on domain only".
 *
 * Event names double as the `audit_logs.action` values stored for each
 * event — kept 1:1 deliberately so `AuditListener` needs no separate
 * name-to-action mapping table.
 */

export const AUTH_LOGIN_EVENT = 'auth.login';
export const AUTH_LOGIN_FAILED_EVENT = 'auth.login_failed';
export const CONNECTOR_REVOKED_EVENT = 'connector.revoked';
export const SUGGESTION_REVIEWED_EVENT = 'suggestion.reviewed';

export interface AuthLoginEventPayload {
  userId: string;
}

export interface AuthLoginFailedEventPayload {
  /** null when the email doesn't match any account. */
  userId: string | null;
  email: string;
}

export interface ConnectorRevokedEventPayload {
  userId: string;
  connectionId: string;
  provider: string;
}

export interface SuggestionReviewedEventPayload {
  userId: string;
  suggestionId: string;
  decision: string;
}
