import {
  LeadTier,
  Persona,
  ScoreRule,
  SuggestedAction,
  WorkTool,
} from './lead-enums';

export interface LeadScoreFacts {
  persona: Persona | null;
  dueDate: string | null; // YYYY-MM-DD
  workTools: WorkTool[] | null;
  hasActiveConnector: boolean;
  hasPaywallSignal: boolean;
}

export interface ScoreBreakdownEntry {
  rule: ScoreRule;
  points: number;
}

export interface LeadScoreResult {
  score: number;
  tier: LeadTier;
  breakdown: ScoreBreakdownEntry[];
}

export const toUtcDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Adds calendar months, clamping to the last day of a shorter month. */
export function addCalendarMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toUtcDate(target);
}

export const tierForScore = (score: number): LeadTier =>
  score >= 8 ? LeadTier.Hot : score >= 4 ? LeadTier.Warm : LeadTier.Cold;

export function computeLeadScore(
  facts: LeadScoreFacts,
  now: Date,
): LeadScoreResult {
  const today = toUtcDate(now);
  const breakdown: ScoreBreakdownEntry[] = [];
  const add = (rule: ScoreRule, points: number) =>
    breakdown.push({ rule, points });
  if (facts.dueDate && facts.dueDate >= today) {
    if (facts.dueDate < addCalendarMonths(today, 3)) {
      add(ScoreRule.DueWithin3Months, 3);
    } else if (facts.dueDate <= addCalendarMonths(today, 6)) {
      add(ScoreRule.DueWithin3To6Months, 2);
    }
  }
  if (facts.persona === Persona.Apprentice) add(ScoreRule.PersonaApprentice, 2);
  if (facts.persona === Persona.Intern) add(ScoreRule.PersonaIntern, 1);
  if (facts.workTools?.includes(WorkTool.Trello)) add(ScoreRule.CitedTrello, 2);
  if (facts.hasActiveConnector) add(ScoreRule.ConnectedTool, 3);
  if (facts.hasPaywallSignal) add(ScoreRule.ExportPaywallHit, 3);
  const score = breakdown.reduce((sum, entry) => sum + entry.points, 0);
  return { score, tier: tierForScore(score), breakdown };
}

const ACTION_BY_TIER: Record<LeadTier, SuggestedAction> = {
  [LeadTier.Hot]: SuggestedAction.InterviewAndProOffer,
  [LeadTier.Warm]: SuggestedAction.ScheduledEmails,
  [LeadTier.Cold]: SuggestedAction.Newsletter,
};

export const suggestedAction = (
  tier: LeadTier,
  optIn: boolean,
): SuggestedAction =>
  optIn ? ACTION_BY_TIER[tier] : SuggestedAction.NoOutreach;
