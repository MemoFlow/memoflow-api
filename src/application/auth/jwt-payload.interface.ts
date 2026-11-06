export interface JwtPayload {
  sub: string;
  email: string;
  /** `users.token_version` at issue time; a missing value counts as 0. */
  tv?: number;
  /** Expiry (seconds since epoch), added by `JwtService` on signing. */
  exp?: number;
}
