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
export const AUTH_PASSWORD_RESET_REQUESTED_EVENT =
  'auth.password_reset_requested';
export const AUTH_PASSWORD_RESET_COMPLETED_EVENT =
  'auth.password_reset_completed';
export const AUTH_PASSWORD_CHANGED_EVENT = 'auth.password_changed';
export const AUTH_LOGIN_THROTTLED_EVENT = 'auth.login_throttled';
export const AUTH_LOGOUT_EVENT = 'auth.logout';
export const AUTH_EMAIL_VERIFIED_EVENT = 'auth.email_verified';
export const CONNECTOR_REVOKED_EVENT = 'connector.revoked';
export const SUGGESTION_REVIEWED_EVENT = 'suggestion.reviewed';
export const TEMPLATE_CREATED_EVENT = 'template.created';
export const TEMPLATE_UPDATED_EVENT = 'template.updated';
export const TEMPLATE_PUBLISHED_EVENT = 'template.published';
export const TEMPLATE_UNPUBLISHED_EVENT = 'template.unpublished';
export const TEMPLATE_DELETED_EVENT = 'template.deleted';
export const USER_ROLE_CHANGED_EVENT = 'user.role_changed';
export const PROMPT_CREATED_EVENT = 'prompt.created';
export const PROMPT_ACTIVATED_EVENT = 'prompt.activated';

export interface AuthLoginEventPayload {
  userId: string;
}

export interface AuthLoginFailedEventPayload {
  /** null when the email doesn't match any account. */
  userId: string | null;
  email: string;
}

export interface AuthLoginThrottledEventPayload {
  /** Always null: the throttle fires before any account lookup. */
  userId: null;
  email: string;
}

/** Shared by the password/email audit events. */
export interface AuthAccountEventPayload {
  userId: string;
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

/** Shared by the admin prompt events; `userId` is the acting admin. */
export interface PromptAuditEventPayload {
  userId: string;
  promptId: string;
  featureType: string;
  version: string;
}

/**
 * Shared by the template audit events; `userId` is the acting user. Ids and
 * field names only — never template content. `changedFields` is set on
 * `template.updated` (names of the patch keys that were present).
 */
export interface TemplateAuditEventPayload {
  userId: string;
  templateId: string;
  changedFields?: string[];
}
