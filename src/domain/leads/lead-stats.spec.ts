import {
  AcademicLevel,
  AcquisitionChannel,
  Blocker,
  DeliverableType,
  LeadSignalType,
  LeadTier,
  Persona,
  SuggestedAction,
  WorkTool,
} from './lead-enums';
import { LeadRow } from './lead-read.repository';
import { computeLeadStats } from './lead-stats';

const NOW = new Date('2026-11-06T12:00:00Z');

const row = (over: Partial<LeadRow> = {}): LeadRow => ({
  userId: 'u',
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
  ...over,
});

describe('computeLeadStats', () => {
  it('zero-fills every enum key for no rows', () => {
    const stats = computeLeadStats([], NOW);
    expect(stats.generatedAt).toBe(NOW.toISOString());
    expect(stats.totalLeads).toBe(0);
    expect(stats.tiers).toEqual({ hot: 0, warm: 0, cold: 0 });
    expect(Object.keys(stats.suggestedActions).sort()).toEqual(
      Object.values(SuggestedAction).sort(),
    );
    expect(Object.values(stats.suggestedActions).every((n) => n === 0)).toBe(
      true,
    );
    expect(stats.onboarding).toEqual({ notStarted: 0, completed: 0 });
    expect(stats.marketingOptIn).toBe(0);
    expect(stats.connectedTool).toBe(0);
    expect(stats.signals).toEqual({ [LeadSignalType.ExportPaywallHit]: 0 });
    const d = stats.distributions;
    expect(Object.keys(d.persona).sort()).toEqual(
      Object.values(Persona).sort(),
    );
    expect(Object.keys(d.deliverableType).sort()).toEqual(
      Object.values(DeliverableType).sort(),
    );
    expect(Object.keys(d.academicLevel).sort()).toEqual(
      Object.values(AcademicLevel).sort(),
    );
    expect(Object.keys(d.workTools).sort()).toEqual(
      Object.values(WorkTool).sort(),
    );
    expect(Object.keys(d.blockers).sort()).toEqual(
      Object.values(Blocker).sort(),
    );
    expect(Object.keys(d.acquisitionChannel).sort()).toEqual(
      Object.values(AcquisitionChannel).sort(),
    );
  });

  it('counts users and submitted answers', () => {
    const rows = [
      row({
        userId: 'a',
        tier: LeadTier.Hot,
        score: 9,
        onboardingCompleted: true,
        persona: Persona.Apprentice,
        deliverableType: DeliverableType.Thesis,
        academicLevel: AcademicLevel.M2,
        workTools: [WorkTool.Trello, WorkTool.Email],
        blockers: [Blocker.Writing, Blocker.LackOfTime],
        acquisitionChannel: AcquisitionChannel.Friend,
        marketingOptIn: true,
        hasActiveConnector: true,
        hasPaywallSignal: true,
      }),
      row({
        userId: 'b',
        tier: LeadTier.Warm,
        score: 5,
        onboardingCompleted: true,
        persona: Persona.Intern,
        deliverableType: DeliverableType.Other,
        academicLevel: AcademicLevel.L3,
        workTools: [],
        blockers: [Blocker.Writing],
        acquisitionChannel: AcquisitionChannel.School,
        marketingOptIn: false,
      }),
      row({ userId: 'c', marketingOptIn: true }),
    ];
    const stats = computeLeadStats(rows, NOW);
    expect(stats.totalLeads).toBe(3);
    expect(stats.tiers).toEqual({ hot: 1, warm: 1, cold: 1 });
    expect(stats.suggestedActions).toEqual({
      interview_and_pro_offer: 1,
      scheduled_emails: 0,
      newsletter: 1,
      no_outreach: 1,
    });
    expect(stats.onboarding).toEqual({ notStarted: 1, completed: 2 });
    expect(stats.marketingOptIn).toBe(2);
    expect(stats.connectedTool).toBe(1);
    expect(stats.signals.export_paywall_hit).toBe(1);
    expect(stats.distributions.persona).toEqual({
      apprentice: 1,
      intern: 1,
      student: 0,
      other: 0,
    });
    expect(stats.distributions.workTools.trello).toBe(1);
    expect(stats.distributions.workTools.email).toBe(1);
    expect(stats.distributions.blockers.writing).toBe(2);
    expect(stats.distributions.blockers.lack_of_time).toBe(1);
    expect(stats.distributions.acquisitionChannel.friend).toBe(1);
  });
});
