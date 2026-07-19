import { randomUUID } from 'node:crypto';
import {
  DOCUMENT_CREATED_EVENT,
  SECTION_CREATED_EVENT,
  SECTION_UPDATED_EVENT,
} from '../../domain/documents/document-events';
import {
  DailyMission,
  MissionCriteria,
} from '../../domain/gamification/daily-mission.entity';
import { DailyMissionRepository } from '../../domain/gamification/daily-mission.repository';
import { Milestone } from '../../domain/gamification/milestone.entity';
import {
  AwardMilestoneData,
  AwardMilestoneResult,
  MilestoneRepository,
} from '../../domain/gamification/milestone.repository';
import { MissionProgress } from '../../domain/gamification/mission-progress.entity';
import {
  IncrementMissionProgressResult,
  MissionProgressRepository,
} from '../../domain/gamification/mission-progress.repository';
import { HandleGamificationEventUseCase } from './handle-gamification-event.use-case';

/**
 * Stands in for the single Postgres transaction that
 * `MilestoneTypeOrmRepository.awardOnce` / `MissionProgressTypeOrmRepository
 * .incrementAtomic` each run for real (award/progress row + `users.xp`/
 * `level` update, in one transaction) — both fakes below share one of these
 * so a test can assert the net xp effect across both award paths, the same
 * way both real repositories ultimately write into the same `users` table.
 */
class FakeXpLedger {
  private readonly xpByUser = new Map<string, number>();

  increment(userId: string, delta: number): { xp: number; level: number } {
    const nextXp = (this.xpByUser.get(userId) ?? 0) + delta;
    this.xpByUser.set(userId, nextXp);
    return { xp: nextXp, level: Math.floor(nextXp / 100) + 1 };
  }

  get(userId: string): number {
    return this.xpByUser.get(userId) ?? 0;
  }
}

class InMemoryMilestoneRepository implements MilestoneRepository {
  private readonly milestones: Milestone[] = [];
  public awardCalls: AwardMilestoneData[] = [];

  constructor(private readonly ledger: FakeXpLedger) {}

  awardOnce(data: AwardMilestoneData): Promise<AwardMilestoneResult | null> {
    this.awardCalls.push(data);
    const exists = this.milestones.find(
      (m) =>
        m.userId === data.userId &&
        m.documentId === data.documentId &&
        m.milestoneType === data.milestoneType,
    );
    if (exists) {
      // Already awarded — the real repository leaves `users` untouched too.
      return Promise.resolve(null);
    }
    const milestone = new Milestone({
      id: randomUUID(),
      userId: data.userId,
      documentId: data.documentId,
      milestoneType: data.milestoneType,
      xpAwarded: data.xpAwarded,
      createdAt: new Date(),
    });
    this.milestones.push(milestone);
    const { xp, level } = this.ledger.increment(data.userId, data.xpAwarded);
    return Promise.resolve({ milestone, xp, level });
  }

  findByUser(userId: string): Promise<Milestone[]> {
    return Promise.resolve(this.milestones.filter((m) => m.userId === userId));
  }
}

class InMemoryDailyMissionRepository implements DailyMissionRepository {
  constructor(private readonly missions: DailyMission[] = []) {}

  findActiveOn(): Promise<DailyMission[]> {
    return Promise.resolve(this.missions);
  }

  findById(id: string): Promise<DailyMission | null> {
    return Promise.resolve(this.missions.find((m) => m.id === id) ?? null);
  }
}

class InMemoryMissionProgressRepository implements MissionProgressRepository {
  private readonly rows = new Map<string, MissionProgress>();
  public incrementCalls: {
    userId: string;
    missionId: string;
    target: number;
    xpReward: number;
  }[] = [];

  constructor(private readonly ledger: FakeXpLedger) {}

  incrementAtomic(
    userId: string,
    missionId: string,
    target: number,
    xpReward: number,
  ): Promise<IncrementMissionProgressResult> {
    this.incrementCalls.push({ userId, missionId, target, xpReward });
    const key = `${userId}:${missionId}`;
    const existing = this.rows.get(key);
    if (existing?.completed) {
      return Promise.resolve({ progress: existing, justCompleted: false });
    }
    const nextProgress = (existing?.progress ?? 0) + 1;
    const completed = nextProgress >= target;
    const updated = new MissionProgress({
      id: existing?.id ?? randomUUID(),
      userId,
      missionId,
      progress: nextProgress,
      completed,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    });
    this.rows.set(key, updated);
    if (!completed) {
      return Promise.resolve({ progress: updated, justCompleted: false });
    }
    const { xp, level } = this.ledger.increment(userId, xpReward);
    return Promise.resolve({
      progress: updated,
      justCompleted: true,
      xp,
      level,
    });
  }

  findByUserAndMissions(): Promise<MissionProgress[]> {
    return Promise.reject(new Error('not implemented'));
  }
}

function makeMission(
  overrides: Partial<{
    id: string;
    criteria: MissionCriteria;
    xpReward: number;
  }> = {},
): DailyMission {
  return new DailyMission({
    id: overrides.id ?? 'mission-1',
    code: 'test-mission',
    description: 'Test mission',
    xpReward: overrides.xpReward ?? 15,
    criteria: overrides.criteria ?? { event: SECTION_CREATED_EVENT, target: 2 },
    activeDate: new Date(),
    createdAt: new Date(),
  });
}

describe('HandleGamificationEventUseCase', () => {
  it('awards the document_created milestone (50 xp) on document.created', async () => {
    const ledger = new FakeXpLedger();
    const milestoneRepository = new InMemoryMilestoneRepository(ledger);
    const useCase = new HandleGamificationEventUseCase(
      milestoneRepository,
      new InMemoryDailyMissionRepository(),
      new InMemoryMissionProgressRepository(ledger),
    );

    await useCase.execute(DOCUMENT_CREATED_EVENT, {
      userId: 'user-1',
      documentId: 'doc-1',
    });

    expect(ledger.get('user-1')).toBe(50);
  });

  it('does not double-award xp for a repeated event on the same document', async () => {
    const ledger = new FakeXpLedger();
    const milestoneRepository = new InMemoryMilestoneRepository(ledger);
    const useCase = new HandleGamificationEventUseCase(
      milestoneRepository,
      new InMemoryDailyMissionRepository(),
      new InMemoryMissionProgressRepository(ledger),
    );

    const payload = { userId: 'user-1', documentId: 'doc-1' };
    await useCase.execute(DOCUMENT_CREATED_EVENT, payload);
    await useCase.execute(DOCUMENT_CREATED_EVENT, payload);

    // awardOnce was attempted twice, but the second call is a no-op (null,
    // no xp touched), so the ledger only ever reflects one award.
    expect(milestoneRepository.awardCalls).toHaveLength(2);
    expect(ledger.get('user-1')).toBe(50);
  });

  it('awards section_goal only when section.updated wordCount reaches the threshold', async () => {
    const ledger = new FakeXpLedger();
    const milestoneRepository = new InMemoryMilestoneRepository(ledger);
    const useCase = new HandleGamificationEventUseCase(
      milestoneRepository,
      new InMemoryDailyMissionRepository(),
      new InMemoryMissionProgressRepository(ledger),
    );

    await useCase.execute(SECTION_UPDATED_EVENT, {
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: 'section-1',
      wordCount: 40,
    });
    expect(ledger.get('user-1')).toBe(0);

    await useCase.execute(SECTION_UPDATED_EVENT, {
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: 'section-1',
      wordCount: 100,
    });
    expect(ledger.get('user-1')).toBe(25);
  });

  it('advances mission progress and awards xp exactly once on completion', async () => {
    const mission = makeMission({
      criteria: { event: SECTION_CREATED_EVENT, target: 2 },
      xpReward: 15,
    });
    const ledger = new FakeXpLedger();
    const missionProgressRepository = new InMemoryMissionProgressRepository(
      ledger,
    );
    const useCase = new HandleGamificationEventUseCase(
      new InMemoryMilestoneRepository(ledger),
      new InMemoryDailyMissionRepository([mission]),
      missionProgressRepository,
    );

    const payload = { userId: 'user-1', documentId: 'doc-1' };
    await useCase.execute(SECTION_CREATED_EVENT, {
      ...payload,
      sectionId: 'section-1',
    });
    // First event: progress 1/2, not yet completed — no mission XP (though
    // the first_section milestone does award 25 xp here).
    expect(ledger.get('user-1')).toBe(25);

    await useCase.execute(SECTION_CREATED_EVENT, {
      ...payload,
      sectionId: 'section-2',
    });
    // Second event: progress 2/2, mission completes — its 15 xp is awarded
    // exactly once (the first_section milestone doesn't re-award).
    expect(ledger.get('user-1')).toBe(40);

    await useCase.execute(SECTION_CREATED_EVENT, {
      ...payload,
      sectionId: 'section-3',
    });
    // Third event: mission already completed — no further xp from it.
    expect(ledger.get('user-1')).toBe(40);
  });

  it('leaves xp unchanged when awardOnce returns null (already awarded)', async () => {
    const ledger = new FakeXpLedger();
    const milestoneRepository = new InMemoryMilestoneRepository(ledger);
    const data: AwardMilestoneData = {
      userId: 'user-1',
      documentId: 'doc-1',
      milestoneType: 'document_created',
      xpAwarded: 50,
    };

    const first = await milestoneRepository.awardOnce(data);
    expect(first).not.toBeNull();
    expect(ledger.get('user-1')).toBe(50);

    const second = await milestoneRepository.awardOnce(data);
    expect(second).toBeNull();
    // The whole point of the atomic award transaction: a no-op award must
    // leave `users` completely untouched, not just "not awarded again".
    expect(ledger.get('user-1')).toBe(50);
  });

  it('ignores missions whose criteria.event does not match the fired event', async () => {
    const mission = makeMission({
      criteria: { event: 'some.other.event', target: 1 },
    });
    const ledger = new FakeXpLedger();
    const missionProgressRepository = new InMemoryMissionProgressRepository(
      ledger,
    );
    const useCase = new HandleGamificationEventUseCase(
      new InMemoryMilestoneRepository(ledger),
      new InMemoryDailyMissionRepository([mission]),
      missionProgressRepository,
    );

    await useCase.execute(SECTION_CREATED_EVENT, {
      userId: 'user-1',
      documentId: 'doc-1',
      sectionId: 'section-1',
    });

    expect(missionProgressRepository.incrementCalls).toEqual([]);
  });
});
