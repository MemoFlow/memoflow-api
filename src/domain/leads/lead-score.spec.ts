import {
  addCalendarMonths,
  computeLeadScore,
  LeadScoreFacts,
  suggestedAction,
  tierForScore,
} from './lead-score';
import {
  LeadTier,
  Persona,
  ScoreRule,
  SuggestedAction,
  WorkTool,
} from './lead-enums';

const NOW = new Date('2026-11-30T12:00:00Z');

const facts = (over: Partial<LeadScoreFacts> = {}): LeadScoreFacts => ({
  persona: null,
  dueDate: null,
  workTools: null,
  hasActiveConnector: false,
  hasPaywallSignal: false,
  ...over,
});

const rules = (f: LeadScoreFacts) =>
  computeLeadScore(f, NOW).breakdown.map((b) => [b.rule, b.points]);

describe('addCalendarMonths', () => {
  it('clamps to the last day of a shorter month (30 Nov + 3 = 28 Feb)', () => {
    expect(addCalendarMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
  it('handles leap years', () => {
    expect(addCalendarMonths('2027-11-30', 3)).toBe('2028-02-29');
  });
  it('rolls over the year', () => {
    expect(addCalendarMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('computeLeadScore', () => {
  it('scores 0 with no facts', () => {
    expect(computeLeadScore(facts(), NOW)).toEqual({
      score: 0,
      tier: LeadTier.Cold,
      breakdown: [],
    });
  });

  it('due today scores due_within_3_months', () => {
    expect(rules(facts({ dueDate: '2026-11-30' }))).toEqual([
      [ScoreRule.DueWithin3Months, 3],
    ]);
  });

  it('a past due date scores 0', () => {
    expect(rules(facts({ dueDate: '2026-11-29' }))).toEqual([]);
  });

  it('day before the 3-month boundary is within 3 months', () => {
    expect(rules(facts({ dueDate: '2027-02-27' }))).toEqual([
      [ScoreRule.DueWithin3Months, 3],
    ]);
  });

  it('exactly 3 months (28 Feb) falls in the 3-to-6 band', () => {
    expect(rules(facts({ dueDate: '2027-02-28' }))).toEqual([
      [ScoreRule.DueWithin3To6Months, 2],
    ]);
  });

  it('exactly 6 months is inclusive, one day later scores 0', () => {
    const sixMonths = addCalendarMonths('2026-11-30', 6);
    expect(sixMonths).toBe('2027-05-30');
    expect(rules(facts({ dueDate: sixMonths }))).toEqual([
      [ScoreRule.DueWithin3To6Months, 2],
    ]);
    expect(rules(facts({ dueDate: '2027-05-31' }))).toEqual([]);
  });

  it('persona rules', () => {
    expect(rules(facts({ persona: Persona.Apprentice }))).toEqual([
      [ScoreRule.PersonaApprentice, 2],
    ]);
    expect(rules(facts({ persona: Persona.Intern }))).toEqual([
      [ScoreRule.PersonaIntern, 1],
    ]);
    expect(rules(facts({ persona: Persona.Student }))).toEqual([]);
    expect(rules(facts({ persona: Persona.Other }))).toEqual([]);
  });

  it('cited_trello only when trello is in work_tools', () => {
    expect(
      rules(facts({ workTools: [WorkTool.Email, WorkTool.Trello] })),
    ).toEqual([[ScoreRule.CitedTrello, 2]]);
    expect(rules(facts({ workTools: [] }))).toEqual([]);
    expect(rules(facts({ workTools: null }))).toEqual([]);
  });

  it('connected_tool scores once', () => {
    expect(rules(facts({ hasActiveConnector: true }))).toEqual([
      [ScoreRule.ConnectedTool, 3],
    ]);
  });

  it('export_paywall_hit scores 3', () => {
    expect(rules(facts({ hasPaywallSignal: true }))).toEqual([
      [ScoreRule.ExportPaywallHit, 3],
    ]);
  });

  it('reaches the maximum of 13', () => {
    const result = computeLeadScore(
      facts({
        persona: Persona.Apprentice,
        dueDate: '2026-12-15',
        workTools: [WorkTool.Trello],
        hasActiveConnector: true,
        hasPaywallSignal: true,
      }),
      NOW,
    );
    expect(result.score).toBe(13);
    expect(result.tier).toBe(LeadTier.Hot);
    expect(result.breakdown).toHaveLength(5);
  });

  it('onboarding answers alone cap at 7 (warm)', () => {
    const result = computeLeadScore(
      facts({
        persona: Persona.Apprentice,
        dueDate: '2026-12-15',
        workTools: [WorkTool.Trello],
      }),
      NOW,
    );
    expect(result.score).toBe(7);
    expect(result.tier).toBe(LeadTier.Warm);
  });
});

describe('tierForScore', () => {
  it.each([
    [0, LeadTier.Cold],
    [3, LeadTier.Cold],
    [4, LeadTier.Warm],
    [7, LeadTier.Warm],
    [8, LeadTier.Hot],
    [13, LeadTier.Hot],
  ])('score %i -> %s', (score, tier) => {
    expect(tierForScore(score)).toBe(tier);
  });
});

describe('suggestedAction', () => {
  it('maps tier to action with opt-in', () => {
    expect(suggestedAction(LeadTier.Hot, true)).toBe(
      SuggestedAction.InterviewAndProOffer,
    );
    expect(suggestedAction(LeadTier.Warm, true)).toBe(
      SuggestedAction.ScheduledEmails,
    );
    expect(suggestedAction(LeadTier.Cold, true)).toBe(
      SuggestedAction.Newsletter,
    );
  });

  it('returns no_outreach for every tier without opt-in', () => {
    for (const tier of Object.values(LeadTier)) {
      expect(suggestedAction(tier, false)).toBe(SuggestedAction.NoOutreach);
    }
  });
});
