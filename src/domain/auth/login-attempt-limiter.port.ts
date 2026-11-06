export const LOGIN_ATTEMPT_LIMITER = Symbol('LoginAttemptLimiter');

/** Failed attempts allowed per account (email) within the window. */
export const LOGIN_MAX_ATTEMPTS = 10;
/** Length of the counting window, in seconds. */
export const LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;

export interface LoginAttemptResult {
  allowed: boolean;
  /** Seconds until the window resets; meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

/**
 * Per-account login throttle, keyed by the normalized email whether or not an
 * account exists, so the outcome reveals nothing about which addresses are
 * registered. Implementations must be atomic and must fail open: an outage of
 * the backing store must never block logins.
 */
export interface LoginAttemptLimiter {
  /**
   * Counts one attempt and reports whether it may proceed. Counted up front
   * (not after the password check) so concurrent guesses cannot slip past
   * the limit.
   */
  registerAttempt(email: string): Promise<LoginAttemptResult>;
  /** Forgets the account's counter (after a successful login). */
  clear(email: string): Promise<void>;
}
