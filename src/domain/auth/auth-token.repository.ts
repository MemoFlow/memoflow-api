import { AuthTokenType } from './auth-token';

export const AUTH_TOKEN_REPOSITORY = Symbol('AuthTokenRepository');

export interface IssueAuthTokenData {
  userId: string;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
  /** No token is created if one of this type was created this recently. */
  minIntervalMs: number;
}

export interface AuthTokenRepository {
  /**
   * Stores the token unless the account already received one of the same
   * type within `minIntervalMs`. Returns whether a token was stored.
   */
  issue(data: IssueAuthTokenData): Promise<boolean>;
}
