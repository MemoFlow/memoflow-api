/**
 * Domain event contracts for the users feature. Plain TypeScript, no
 * framework imports — same convention as `audit-events.ts` and
 * `document-events.ts`. Emitted via `EventEmitter2`.
 */

export const USER_DISABLED_EVENT = 'user.disabled';

export interface UserDisabledEventPayload {
  userId: string;
}

/**
 * Emitted when an account's `token_version` was bumped (password reset or
 * change), so live sockets issued under the old version can be dropped.
 */
export const USER_SESSIONS_REVOKED_EVENT = 'user.sessions_revoked';

export interface UserSessionsRevokedEventPayload {
  userId: string;
}
