/**
 * Domain entity for `users` (see docs/database-schema.md).
 * Plain TypeScript — no typeorm/mongoose imports.
 */
export class User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: string;
  xp: number;
  level: number;
  lastActiveAt: Date | null;

  constructor(props: {
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    role: string;
    xp: number;
    level: number;
    lastActiveAt: Date | null;
  }) {
    this.id = props.id;
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.displayName = props.displayName;
    this.role = props.role;
    this.xp = props.xp;
    this.level = props.level;
    this.lastActiveAt = props.lastActiveAt;
  }
}
