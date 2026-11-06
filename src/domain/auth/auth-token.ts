import { createHash, randomBytes } from 'crypto';

export enum AuthTokenType {
  PasswordReset = 'password_reset',
  EmailVerification = 'email_verification',
}

export const AUTH_TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  [AuthTokenType.PasswordReset]: 60 * 60 * 1000,
  [AuthTokenType.EmailVerification]: 24 * 60 * 60 * 1000,
};

/** Minimum gap between two tokens of the same type for one account. */
export const AUTH_TOKEN_MIN_INTERVAL_MS = 5 * 60 * 1000;

/** A fresh random token (256 bits, base64url). */
export function generateAuthToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest — the only form of a token that is stored. */
export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
