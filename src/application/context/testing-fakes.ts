import { User } from '../../domain/users/user.entity';
import { UserRole } from '../../domain/users/user-role';
import type { UserRepository } from '../../domain/users/user.repository';
import type { LlmPlanner } from '../../domain/context/llm-planner.port';
import type {
  RetrievedSection,
  SectionRetriever,
  SectionSearchInput,
} from '../../domain/context/section-retriever.port';
import { PlanningPipeline } from './planning-pipeline';

/** Builds a `RetrievedSection`; override per test. */
export function makeRetrieved(
  overrides: Partial<RetrievedSection> = {},
): RetrievedSection {
  return {
    sectionId: 'sec-1',
    documentId: 'doc-1',
    documentTitle: 'Doc',
    title: 'Section',
    content: 'Section content',
    inBoundDocument: true,
    matched: true,
    ...overrides,
  };
}

/** In-memory `SectionRetriever`: returns `sections`, or throws `error`. */
export class FakeSectionRetriever implements SectionRetriever {
  readonly calls: SectionSearchInput[] = [];

  constructor(
    public sections: RetrievedSection[] = [],
    public error: Error | null = null,
  ) {}

  search(input: SectionSearchInput): Promise<RetrievedSection[]> {
    this.calls.push(input);
    return this.error
      ? Promise.reject(this.error)
      : Promise.resolve(this.sections);
  }
}

/** A pipeline over `planner` that retrieves nothing unless told otherwise. */
export function makePipeline(
  planner: LlmPlanner,
  retriever: SectionRetriever = new FakeSectionRetriever(),
  maxInputChars?: number,
): PlanningPipeline {
  return new PlanningPipeline(planner, retriever, maxInputChars);
}

/**
 * `UserRepository` fake for the planning workers: only `findById` is real.
 * Every id resolves to an active user unless listed in `disabled` (disabled)
 * or `missing` (no such user).
 */
export class FakeUserRepository implements UserRepository {
  readonly lookups: string[] = [];

  constructor(
    readonly disabled: Set<string> = new Set(),
    readonly missing: Set<string> = new Set(),
  ) {}

  findById(id: string): Promise<User | null> {
    this.lookups.push(id);
    if (this.missing.has(id)) return Promise.resolve(null);
    return Promise.resolve(
      new User({
        id,
        email: `${id}@example.com`,
        passwordHash: 'hash',
        displayName: 'Test',
        role: UserRole.User,
        xp: 0,
        level: 1,
        lastActiveAt: null,
        disabledAt: this.disabled.has(id) ? new Date() : null,
      }),
    );
  }

  findByEmail = (): Promise<User | null> => this.unsupported();
  create = (): Promise<User> => this.unsupported();
  updateLastActiveAt = (): Promise<void> => this.unsupported();
  setDisabledAt = (): Promise<void> => this.unsupported();
  revokeSessions = (): Promise<number> => this.unsupported();
  verifyEmailWithToken = (): Promise<string | null> => this.unsupported();
  changePassword = (): Promise<number> => this.unsupported();
  resetPasswordWithToken = (): Promise<string | null> => this.unsupported();
  findTopByXp = (): Promise<User[]> => this.unsupported();

  private unsupported<T>(): Promise<T> {
    return Promise.reject(new Error('not implemented'));
  }
}
