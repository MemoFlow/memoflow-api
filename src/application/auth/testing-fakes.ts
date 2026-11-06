import { randomUUID } from 'node:crypto';
import { AuthTokenType } from '../../domain/auth/auth-token';
import {
  AuthTokenRepository,
  IssueAuthTokenData,
} from '../../domain/auth/auth-token.repository';
import {
  EmailMessage,
  EmailSender,
} from '../../domain/email/email-sender.port';
import { UserRole } from '../../domain/users/user-role';
import { User } from '../../domain/users/user.entity';
import {
  CreateUserData,
  UserRepository,
} from '../../domain/users/user.repository';

export function makeUser(overrides: Partial<User> = {}): User {
  return Object.assign(
    new User({
      id: 'user-1',
      email: 'ada@example.com',
      passwordHash: 'hash',
      displayName: 'Ada',
      role: UserRole.User,
      xp: 0,
      level: 1,
      lastActiveAt: null,
    }),
    overrides,
  );
}

export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failWith: Error | null = null;

  send(message: EmailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(message);
    return Promise.resolve();
  }
}

export class FakeUserRepository implements UserRepository {
  readonly passwordChanges: Array<{ id: string; hash: string }> = [];
  readonly resets: Array<{ id: string; hash: string }> = [];
  readonly verified: string[] = [];

  /** When set, the next reset fails as if the database update errored. */
  failUpdate: Error | null = null;

  constructor(
    readonly users: User[] = [],
    readonly tokens: FakeAuthTokenRepository = new FakeAuthTokenRepository(),
  ) {}

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.id === id) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.email === email) ?? null);
  }

  create(data: CreateUserData): Promise<User> {
    const user = makeUser({
      id: randomUUID(),
      email: data.email,
      passwordHash: data.passwordHash,
      displayName: data.displayName,
    });
    this.users.push(user);
    return Promise.resolve(user);
  }

  updateLastActiveAt(): Promise<void> {
    return Promise.resolve();
  }

  setDisabledAt(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  verifyEmailWithToken(tokenHash: string, at: Date): Promise<string | null> {
    const peeked = this.tokens.peek(tokenHash, AuthTokenType.EmailVerification);
    const user = this.users.find((u) => u.id === peeked);
    // Disabled or missing account: nothing changes, the token stays unspent.
    if (!peeked || !user || user.isDisabled) return Promise.resolve(null);
    const userId = peeked;
    this.tokens.consume(tokenHash, AuthTokenType.EmailVerification);
    if (!user.emailVerifiedAt) user.emailVerifiedAt = at;
    this.verified.push(userId);
    return Promise.resolve(userId);
  }

  revokeSessions(id: string): Promise<number> {
    const user = this.users.find((u) => u.id === id);
    if (!user) return Promise.reject(new Error('User not found'));
    user.tokenVersion += 1;
    return Promise.resolve(user.tokenVersion);
  }

  changePassword(id: string, passwordHash: string): Promise<number> {
    const user = this.users.find((u) => u.id === id);
    if (!user) return Promise.reject(new Error('User not found'));
    user.passwordHash = passwordHash;
    user.tokenVersion += 1;
    this.passwordChanges.push({ id, hash: passwordHash });
    return Promise.resolve(user.tokenVersion);
  }

  resetPasswordWithToken(
    tokenHash: string,
    passwordHash: string,
    at: Date,
  ): Promise<string | null> {
    if (this.failUpdate) return Promise.reject(this.failUpdate);
    const userId = this.tokens.peek(tokenHash, AuthTokenType.PasswordReset);
    const user = this.users.find((u) => u.id === userId);
    // Disabled or missing account: nothing changes, the token stays unspent.
    if (!userId || !user || user.isDisabled) return Promise.resolve(null);
    this.tokens.consume(tokenHash, AuthTokenType.PasswordReset);
    user.passwordHash = passwordHash;
    user.tokenVersion += 1;
    if (!user.emailVerifiedAt) user.emailVerifiedAt = at;
    this.resets.push({ id: userId, hash: passwordHash });
    return Promise.resolve(userId);
  }

  findTopByXp(): Promise<User[]> {
    return Promise.reject(new Error('not implemented'));
  }
}

export class FakeAuthTokenRepository implements AuthTokenRepository {
  readonly issued: Array<IssueAuthTokenData & { createdAt: number }> = [];
  readonly used = new Set<string>();

  issue(data: IssueAuthTokenData): Promise<boolean> {
    const now = Date.now();
    const recent = this.issued.some(
      (t) =>
        t.userId === data.userId &&
        t.type === data.type &&
        now - t.createdAt < data.minIntervalMs,
    );
    if (recent) return Promise.resolve(false);
    this.issued.push({ ...data, createdAt: now });
    return Promise.resolve(true);
  }

  /** Owner of a currently valid token, without spending it. */
  peek(tokenHash: string, type: AuthTokenType): string | null {
    const token = this.issued.find(
      (t) => t.tokenHash === tokenHash && t.type === type,
    );
    if (
      !token ||
      this.used.has(tokenHash) ||
      token.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }
    return token.userId;
  }

  consume(tokenHash: string, type: AuthTokenType): string | null {
    const userId = this.peek(tokenHash, type);
    if (userId) this.used.add(tokenHash);
    return userId;
  }
}
