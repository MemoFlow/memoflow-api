export interface JwtPayload {
  sub: string;
  email: string;
  /** `users.token_version` at issue time; a missing value counts as 0. */
  tv?: number;
}
