import { NotFoundException } from '@nestjs/common';
import { DailyMission } from '../../domain/gamification/daily-mission.entity';
import { DailyMissionRepository } from '../../domain/gamification/daily-mission.repository';
import { Milestone } from '../../domain/gamification/milestone.entity';
import {
  AwardMilestoneResult,
  MilestoneRepository,
} from '../../domain/gamification/milestone.repository';
import { MissionProgress } from '../../domain/gamification/mission-progress.entity';
import {
  IncrementMissionProgressResult,
  MissionProgressRepository,
} from '../../domain/gamification/mission-progress.repository';
import { User } from '../../domain/users/user.entity';
import { UserRepository } from '../../domain/users/user.repository';
import { GetMyGamificationUseCase } from './get-my-gamification.use-case';

class InMemoryUserRepository implements UserRepository {
  constructor(private readonly users: User[] = []) {}

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.id === id) ?? null);
  }

  findByEmail(): Promise<User | null> {
    return Promise.reject(new Error('not implemented'));
  }

  create(): Promise<User> {
    return Promise.reject(new Error('not implemented'));
  }

  updateLastActiveAt(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }

  findTopByXp(): Promise<User[]> {
    return Promise.reject(new Error('not implemented'));
  }
}

class InMemoryMilestoneRepository implements MilestoneRepository {
  constructor(private readonly milestones: Milestone[] = []) {}

  awardOnce(): Promise<AwardMilestoneResult | null> {
    return Promise.reject(new Error('not implemented'));
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
  constructor(private readonly rows: MissionProgress[] = []) {}

  incrementAtomic(): Promise<IncrementMissionProgressResult> {
    return Promise.reject(new Error('not implemented'));
  }

  findByUserAndMissions(
    userId: string,
    missionIds: string[],
  ): Promise<MissionProgress[]> {
    return Promise.resolve(
      this.rows.filter(
        (row) => row.userId === userId && missionIds.includes(row.missionId),
      ),
    );
  }
}

function makeUser(overrides: Partial<User> = {}): User {
  return new User({
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'hash',
    displayName: 'Test User',
    role: 'user',
    xp: 150,
    level: 2,
    lastActiveAt: null,
    ...overrides,
  });
}

function makeMission(overrides: Partial<{ id: string }> = {}): DailyMission {
  return new DailyMission({
    id: overrides.id ?? 'mission-1',
    code: 'write-3-sections',
    description: 'Update 3 sections today',
    xpReward: 15,
    criteria: { event: 'section.updated', target: 3 },
    activeDate: new Date(),
    createdAt: new Date(),
  });
}

function makeProgress(
  overrides: Partial<{
    userId: string;
    missionId: string;
    progress: number;
    completed: boolean;
  }> = {},
): MissionProgress {
  return new MissionProgress({
    id: 'progress-1',
    userId: overrides.userId ?? 'user-1',
    missionId: overrides.missionId ?? 'mission-1',
    progress: overrides.progress ?? 2,
    completed: overrides.completed ?? false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('GetMyGamificationUseCase', () => {
  it('returns xp/level plus milestones and today missions with progress merged in', async () => {
    const user = makeUser();
    const milestone = new Milestone({
      id: 'milestone-1',
      userId: 'user-1',
      documentId: 'doc-1',
      milestoneType: 'document_created',
      xpAwarded: 50,
      createdAt: new Date(),
    });
    const mission = makeMission();
    const progress = makeProgress();

    const useCase = new GetMyGamificationUseCase(
      new InMemoryUserRepository([user]),
      new InMemoryMilestoneRepository([milestone]),
      new InMemoryDailyMissionRepository([mission]),
      new InMemoryMissionProgressRepository([progress]),
    );

    const result = await useCase.execute({ userId: 'user-1' });

    expect(result.xp).toBe(150);
    expect(result.level).toBe(2);
    expect(result.milestones).toEqual([milestone]);
    expect(result.todayMissions).toEqual([
      { mission, progress: 2, completed: false },
    ]);
  });

  it('defaults progress to 0/incomplete for a mission with no progress row yet', async () => {
    const user = makeUser();
    const mission = makeMission();

    const useCase = new GetMyGamificationUseCase(
      new InMemoryUserRepository([user]),
      new InMemoryMilestoneRepository([]),
      new InMemoryDailyMissionRepository([mission]),
      new InMemoryMissionProgressRepository([]),
    );

    const result = await useCase.execute({ userId: 'user-1' });

    expect(result.todayMissions).toEqual([
      { mission, progress: 0, completed: false },
    ]);
  });

  it('throws NotFoundException when the user does not exist', async () => {
    const useCase = new GetMyGamificationUseCase(
      new InMemoryUserRepository([]),
      new InMemoryMilestoneRepository([]),
      new InMemoryDailyMissionRepository([]),
      new InMemoryMissionProgressRepository([]),
    );

    await expect(useCase.execute({ userId: 'missing' })).rejects.toThrow(
      NotFoundException,
    );
  });
});
