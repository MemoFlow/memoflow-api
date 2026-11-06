/**
 * Domain event contracts for the users feature. Plain TypeScript, no
 * framework imports — same convention as `audit-events.ts` and
 * `document-events.ts`. Emitted via `EventEmitter2`.
 */

export const USER_DISABLED_EVENT = 'user.disabled';
export const USER_ENABLED_EVENT = 'user.enabled';

export interface UserDisabledEventPayload {
  /** The disabled account. */
  userId: string;
  /** The admin who performed the action. */
  actorId: string;
}

export interface UserEnabledEventPayload {
  /** The re-enabled account. */
  userId: string;
  /** The admin who performed the action. */
  actorId: string;
}

/**
 * Emitted when an account's `token_version` was bumped (password reset or
 * change), so live sockets issued under the old version can be dropped.
 */
export const USER_SESSIONS_REVOKED_EVENT = 'user.sessions_revoked';

export interface UserSessionsRevokedEventPayload {
  userId: string;
}
