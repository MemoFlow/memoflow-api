import { User } from './user.entity';

export const USER_REPOSITORY = Symbol('UserRepository');

export interface CreateUserData {
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  updateLastActiveAt(id: string): Promise<void>;
  /** Sets `disabledAt` (or clears it when `null`). */
  setDisabledAt(id: string, disabledAt: Date | null): Promise<void>;
  /** Sets both AI consent columns, or clears both when given nulls. */
  setAiConsent(
    id: string,
    consentAt: Date | null,
    version: string | null,
  ): Promise<void>;
  /**
   * Increments `token_version`, invalidating every access token issued so
   * far (logout everywhere); returns the new version.
   */
  revokeSessions(id: string): Promise<number>;
  /**
   * In one transaction: consumes the unused, unexpired email-verification
   * token with this hash and sets `emailVerifiedAt` if null. Returns the
   * user id, or `null` (nothing changed) when no token matched.
   */
  verifyEmailWithToken(tokenHash: string, at: Date): Promise<string | null>;
  /**
   * Atomically sets the password hash, increments `token_version` and marks
   * the user's unused auth tokens as used (one transaction); returns the new
   * version.
   */
  changePassword(id: string, passwordHash: string): Promise<number>;
  /**
   * In one transaction: consumes the unused, unexpired password-reset token
   * with this hash, then sets the password hash, sets `emailVerifiedAt` if
   * null, increments `token_version` and marks the user's other unused auth
   * tokens as used. If there is no such token, or the account is disabled,
   * nothing changes (the token is not spent) and `null` is returned;
   * otherwise the user id.
   */
  resetPasswordWithToken(
    tokenHash: string,
    passwordHash: string,
    at: Date,
  ): Promise<string | null>;
  /**
   * Top `limit` enabled (not disabled) users by `xp` descending, for the
   * leaderboard.
   */
  findTopByXp(limit: number): Promise<User[]>;
}
