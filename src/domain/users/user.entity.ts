import { AI_NOTICE_VERSION } from '../ai/ai-consent';
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
  /** Null until the email address is verified. */
  emailVerifiedAt: Date | null;
  /** Bumped on password reset/change; JWTs carry it as `tv`. */
  tokenVersion: number;
  /** When AI consent was given; null if never given or withdrawn. */
  aiConsentAt: Date | null;
  /** The AI notice version consented to; null with `aiConsentAt`. */
  aiConsentVersion: string | null;

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
    emailVerifiedAt?: Date | null;
    tokenVersion?: number;
    aiConsentAt?: Date | null;
    aiConsentVersion?: string | null;
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
    this.emailVerifiedAt = props.emailVerifiedAt ?? null;
    this.tokenVersion = props.tokenVersion ?? 0;
    this.aiConsentAt = props.aiConsentAt ?? null;
    this.aiConsentVersion = props.aiConsentVersion ?? null;
  }

  get isAdmin(): boolean {
    return this.role === UserRole.Admin;
  }

  get isEmailVerified(): boolean {
    return this.emailVerifiedAt !== null;
  }

  /** True only while consent is recorded for the current notice version. */
  get hasCurrentAiConsent(): boolean {
    return (
      this.aiConsentAt !== null && this.aiConsentVersion === AI_NOTICE_VERSION
    );
  }

  get isDisabled(): boolean {
    return this.disabledAt !== null;
  }
}
