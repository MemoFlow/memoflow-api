import { AiQuotaExceededError } from '../../domain/ai/ai-quota.errors';
import type { AiQuota } from '../../domain/ai/ai-quota.port';
import type {
  AiResponseCache,
  CachedSuggestion,
} from '../../domain/ai/ai-response-cache.port';
import { Prompt } from '../../domain/ai/prompt.entity';
import {
  CreatePromptData,
  PromptActivationConflictError,
  PromptRepository,
  PromptVersionConflictError,
} from '../../domain/ai/prompt.repository';

/** Builds a `Prompt` with the v2-shaped defaults; override per test. */
export function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return new Prompt({
    id: 'prompt-1',
    featureType: 'suggestion',
    version: 'v1',
    systemTemplate: 'System <untrusted_{{nonce}}>',
    template: 'Improve this: {{content}}',
    userInvocable: true,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

/** In-memory `PromptRepository` fake mirroring the real uniqueness rules. */
export class InMemoryPromptRepository implements PromptRepository {
  /** Set to make `activate` throw the concurrent-activation conflict. */
  public activationConflict = false;
  private nextId = 1;

  constructor(public prompts: Prompt[] = []) {}

  findActiveByFeatureType(featureType: string): Promise<Prompt | null> {
    return Promise.resolve(
      this.prompts.find((p) => p.featureType === featureType && p.isActive) ??
        null,
    );
  }

  findById(id: string): Promise<Prompt | null> {
    return Promise.resolve(this.prompts.find((p) => p.id === id) ?? null);
  }

  list(featureType?: string): Promise<Prompt[]> {
    return Promise.resolve(
      this.prompts.filter((p) => !featureType || p.featureType === featureType),
    );
  }

  create(data: CreatePromptData): Promise<Prompt> {
    if (
      this.prompts.some(
        (p) => p.featureType === data.featureType && p.version === data.version,
      )
    ) {
      return Promise.reject(new PromptVersionConflictError());
    }
    const prompt = makePrompt({
      id: `prompt-new-${this.nextId++}`,
      featureType: data.featureType,
      version: data.version,
      systemTemplate: data.systemTemplate,
      template: data.template,
      userInvocable: data.userInvocable,
      isActive: false,
    });
    this.prompts.push(prompt);
    return Promise.resolve(prompt);
  }

  activate(id: string): Promise<Prompt | null> {
    if (this.activationConflict) {
      return Promise.reject(new PromptActivationConflictError());
    }
    const target = this.prompts.find((p) => p.id === id);
    if (!target) return Promise.resolve(null);
    for (const p of this.prompts) {
      if (p.featureType === target.featureType) p.isActive = false;
    }
    target.isActive = true;
    return Promise.resolve(target);
  }
}

/** In-memory `AiQuota` with a plain per-user and global counter. */
export class FakeAiQuota implements AiQuota {
  readonly reserved: string[] = [];
  readonly checked: string[] = [];
  /** Set to make every call fail the way the real adapter would. */
  failWith: Error | null = null;

  constructor(
    public userLimit = Number.POSITIVE_INFINITY,
    public globalLimit = Number.POSITIVE_INFINITY,
  ) {}

  reserve(userId: string): Promise<void> {
    const err = this.verdict(userId);
    if (err) return Promise.reject(err);
    this.reserved.push(userId);
    return Promise.resolve();
  }

  check(userId: string): Promise<void> {
    this.checked.push(userId);
    const err = this.verdict(userId);
    return err ? Promise.reject(err) : Promise.resolve();
  }

  private verdict(userId: string): Error | null {
    if (this.failWith) return this.failWith;
    const mine = this.reserved.filter((id) => id === userId).length;
    if (mine >= this.userLimit || this.reserved.length >= this.globalLimit) {
      return new AiQuotaExceededError(60);
    }
    return null;
  }
}

/** In-memory `AiResponseCache`; `failing` makes it behave like a dead Redis (a miss, a no-op). */
export class FakeAiResponseCache implements AiResponseCache {
  readonly entries = new Map<string, CachedSuggestion>();
  readonly gets: string[] = [];
  failing = false;

  get(key: string): Promise<CachedSuggestion | null> {
    this.gets.push(key);
    return Promise.resolve(
      this.failing ? null : (this.entries.get(key) ?? null),
    );
  }

  set(key: string, value: CachedSuggestion): Promise<void> {
    if (!this.failing) this.entries.set(key, value);
    return Promise.resolve();
  }
}
