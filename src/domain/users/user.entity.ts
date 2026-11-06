import { UserRole } from './user-role';

/**
 * Domain entity for `users` (see docs/database-schema.md).
 * Plain TypeScript — no typeorm/mongoose imports.
 */
export class User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  xp: number;
  level: number;
  lastActiveAt: Date | null;
  /** Set while the account is disabled; `null` for an active account. */
  disabledAt: Date | null;

  constructor(props: {
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    role: UserRole;
    xp: number;
    level: number;
    lastActiveAt: Date | null;
    disabledAt?: Date | null;
  }) {
    this.id = props.id;
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.displayName = props.displayName;
    this.role = props.role;
    this.xp = props.xp;
    this.level = props.level;
    this.lastActiveAt = props.lastActiveAt;
    this.disabledAt = props.disabledAt ?? null;
  }

  get isAdmin(): boolean {
    return this.role === UserRole.Admin;
  }

  get isDisabled(): boolean {
    return this.disabledAt !== null;
  }
}
