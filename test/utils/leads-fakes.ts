// In-memory fakes of the leads ports, shared by the use-case specs only.
import { ConnectorConnection } from '../../src/domain/connectors/connector-connection.entity';
import { ConnectorConnectionRepository } from '../../src/domain/connectors/connector-connection.repository';
import { ConnectorProvider } from '../../src/domain/connectors/connector-provider';
import { ConnectorStatus } from '../../src/domain/connectors/connector-status';
import {
  AcademicLevel,
  AcquisitionChannel,
  Blocker,
  DeliverableType,
  LeadSignalType,
  LeadTier,
  Persona,
  WorkTool,
} from '../../src/domain/leads/lead-enums';
import {
  LeadListFilter,
  LeadReadRepository,
  LeadRow,
} from '../../src/domain/leads/lead-read.repository';
import { LeadScoreResult } from '../../src/domain/leads/lead-score';
import { LeadScoreRepository } from '../../src/domain/leads/lead-score.repository';
import { LeadSignal } from '../../src/domain/leads/lead-signal.entity';
import { LeadSignalRepository } from '../../src/domain/leads/lead-signal.repository';
import { OnboardingProfile } from '../../src/domain/leads/onboarding-profile.entity';
import {
  OnboardingProfileRepository,
  SubmitOnboardingData,
} from '../../src/domain/leads/onboarding-profile.repository';

export class InMemoryOnboardingProfileRepository implements OnboardingProfileRepository {
  rows = new Map<string, OnboardingProfile>();

  findByUserId(userId: string): Promise<OnboardingProfile | null> {
    return Promise.resolve(this.rows.get(userId) ?? null);
  }

  upsert(data: SubmitOnboardingData, now: Date): Promise<OnboardingProfile> {
    const existing = this.rows.get(data.userId);
    const changed = existing?.marketingOptIn !== data.marketingOptIn;
    const row = new OnboardingProfile({
      ...data,
      marketingOptInAt: existing && !changed ? existing.marketingOptInAt : now,
      submittedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.rows.set(data.userId, row);
    return Promise.resolve(row);
  }

  updateConsent(
    userId: string,
    optIn: boolean,
    now: Date,
  ): Promise<OnboardingProfile | null> {
    const existing = this.rows.get(userId);
    if (!existing) return Promise.resolve(null);
    const row = new OnboardingProfile({
      ...existing,
      marketingOptIn: optIn,
      marketingOptInAt:
        existing.marketingOptIn === optIn ? existing.marketingOptInAt : now,
      updatedAt: now,
    });
    this.rows.set(userId, row);
    return Promise.resolve(row);
  }
}

export class InMemoryLeadSignalRepository implements LeadSignalRepository {
  rows: LeadSignal[] = [];

  record(userId: string, type: LeadSignalType, now: Date): Promise<void> {
    const existing = this.rows.find(
      (r) => r.userId === userId && r.type === type,
    );
    if (existing) {
      existing.occurrences += 1;
      existing.lastSeenAt = now;
    } else {
      this.rows.push(
        new LeadSignal({
          id: `sig-${this.rows.length + 1}`,
          userId,
          type,
          firstSeenAt: now,
          lastSeenAt: now,
          occurrences: 1,
        }),
      );
    }
    return Promise.resolve();
  }

  findByUserId(userId: string): Promise<LeadSignal[]> {
    return Promise.resolve(this.rows.filter((r) => r.userId === userId));
  }
}

export class InMemoryLeadScoreRepository implements LeadScoreRepository {
  rows = new Map<string, LeadScoreResult & { computedAt: Date }>();

  saveIfNewer(
    userId: string,
    result: LeadScoreResult,
    computedAt: Date,
  ): Promise<void> {
    const existing = this.rows.get(userId);
    if (!existing || existing.computedAt <= computedAt) {
      this.rows.set(userId, { ...result, computedAt });
    }
    return Promise.resolve();
  }
}

export class InMemoryActiveConnectors implements ConnectorConnectionRepository {
  active = new Set<string>();

  findActiveByUser(userId: string): Promise<ConnectorConnection[]> {
    return Promise.resolve(
      this.active.has(userId)
        ? [
            {
              userId,
              provider: ConnectorProvider.Trello,
              status: ConnectorStatus.Active,
            } as ConnectorConnection,
          ]
        : [],
    );
  }

  findById(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }
  findByUserAndProvider(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }
  findByComposioAccountId(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }
  findAllByUser(): Promise<ConnectorConnection[]> {
    return Promise.reject(new Error('not implemented'));
  }
  upsertInitiated(): Promise<ConnectorConnection> {
    return Promise.reject(new Error('not implemented'));
  }
  updateStatus(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }
}

export function makeSubmitData(
  overrides: Partial<SubmitOnboardingData> = {},
): SubmitOnboardingData {
  return {
    userId: 'user-1',
    persona: Persona.Apprentice,
    deliverableType: DeliverableType.ApprenticeshipReport,
    dueDate: '2099-01-15',
    academicLevel: AcademicLevel.M2,
    schoolName: null,
    workTools: [WorkTool.Trello],
    blockers: [Blocker.LackOfTime],
    acquisitionChannel: AcquisitionChannel.Friend,
    marketingOptIn: true,
    ...overrides,
  };
}

export class InMemoryLeadReadRepository implements LeadReadRepository {
  rows: LeadRow[] = [];
  lastFilter: LeadListFilter | null = null;
  lastToday: string | null = null;

  list(
    filter: LeadListFilter,
    today: string,
  ): Promise<{ rows: LeadRow[]; total: number }> {
    this.lastFilter = filter;
    this.lastToday = today;
    const start = (filter.page - 1) * filter.limit;
    return Promise.resolve({
      rows: this.rows.slice(start, start + filter.limit),
      total: this.rows.length,
    });
  }

  findEligibleByUserId(userId: string): Promise<LeadRow | null> {
    return Promise.resolve(this.rows.find((r) => r.userId === userId) ?? null);
  }

  findAllEligible(): Promise<LeadRow[]> {
    return Promise.resolve(this.rows);
  }
}

export function makeLeadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    userId: 'user-1',
    email: 'u@x.io',
    displayName: 'U',
    score: 0,
    tier: LeadTier.Cold,
    breakdown: [],
    scoreComputedAt: null,
    onboardingCompleted: false,
    persona: null,
    deliverableType: null,
    dueDate: null,
    academicLevel: null,
    workTools: null,
    blockers: null,
    acquisitionChannel: null,
    marketingOptIn: false,
    hasActiveConnector: false,
    hasPaywallSignal: false,
    registeredAt: new Date('2026-01-01T00:00:00Z'),
    lastActiveAt: null,
    ...overrides,
  };
}
