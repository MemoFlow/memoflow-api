/**
 * Internal domain events that trigger outbound auth emails. They are handled
 * off the request path by `AuthMailListener`, so request timing and response
 * never depend on whether an account exists.
 */

export const AUTH_VERIFICATION_REQUESTED_EVENT = 'auth.verification_requested';
export const AUTH_RESET_LINK_REQUESTED_EVENT = 'auth.reset_link_requested';

export interface AuthVerificationRequestedEventPayload {
  userId: string;
}

export type ResetLinkReason = 'forgot_password' | 'existing_account';

export interface AuthResetLinkRequestedEventPayload {
  /** Normalized address the request was made for. */
  email: string;
  reason: ResetLinkReason;
}
