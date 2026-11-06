import { AuthTokenType } from './auth-token';

/** Domain entity for `auth_tokens` (see docs/database-schema.md). */
export class AuthToken {
  id: string;
  userId: string;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;

  constructor(props: {
    id: string;
    userId: string;
    type: AuthTokenType;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
  }) {
    this.id = props.id;
    this.userId = props.userId;
    this.type = props.type;
    this.tokenHash = props.tokenHash;
    this.expiresAt = props.expiresAt;
    this.usedAt = props.usedAt;
    this.createdAt = props.createdAt;
  }
}
