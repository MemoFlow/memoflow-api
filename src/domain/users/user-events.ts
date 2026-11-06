/**
 * Domain event contracts for the users feature. Plain TypeScript, no
 * framework imports — same convention as `audit-events.ts` and
 * `document-events.ts`. Emitted via `EventEmitter2`.
 */

export const USER_DISABLED_EVENT = 'user.disabled';

export interface UserDisabledEventPayload {
  userId: string;
}
