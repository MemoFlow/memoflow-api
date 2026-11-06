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
import { suggestedAction } from './lead-score';
import { LeadRow } from './lead-read.repository';

type Counts<K extends string> = Record<K, number>;

export interface LeadStats {
  generatedAt: string;
  totalLeads: number;
  tiers: Counts<LeadTier>;
  suggestedActions: Counts<SuggestedAction>;
  onboarding: { notStarted: number; completed: number };
  marketingOptIn: number;
  connectedTool: number;
  signals: Counts<LeadSignalType>;
  distributions: {
    persona: Counts<Persona>;
    deliverableType: Counts<DeliverableType>;
    academicLevel: Counts<AcademicLevel>;
    workTools: Counts<WorkTool>;
    blockers: Counts<Blocker>;
    acquisitionChannel: Counts<AcquisitionChannel>;
  };
}

function zeroFilled<K extends string>(values: readonly K[]): Counts<K> {
  const counts = {} as Counts<K>;
  for (const value of values) counts[value] = 0;
  return counts;
}

/**
 * Aggregates eligible leads. Every enum key is present (zero-filled); all
 * counts are users, and distributions count submitted answers only.
 */
export function computeLeadStats(rows: LeadRow[], now: Date): LeadStats {
  const stats: LeadStats = {
    generatedAt: now.toISOString(),
    totalLeads: rows.length,
    tiers: zeroFilled(Object.values(LeadTier)),
    suggestedActions: zeroFilled(Object.values(SuggestedAction)),
    onboarding: { notStarted: 0, completed: 0 },
    marketingOptIn: 0,
    connectedTool: 0,
    signals: zeroFilled(Object.values(LeadSignalType)),
    distributions: {
      persona: zeroFilled(Object.values(Persona)),
      deliverableType: zeroFilled(Object.values(DeliverableType)),
      academicLevel: zeroFilled(Object.values(AcademicLevel)),
      workTools: zeroFilled(Object.values(WorkTool)),
      blockers: zeroFilled(Object.values(Blocker)),
      acquisitionChannel: zeroFilled(Object.values(AcquisitionChannel)),
    },
  };

  for (const row of rows) {
    stats.tiers[row.tier] += 1;
    stats.suggestedActions[suggestedAction(row.tier, row.marketingOptIn)] += 1;
    if (row.onboardingCompleted) stats.onboarding.completed += 1;
    else stats.onboarding.notStarted += 1;
    if (row.marketingOptIn) stats.marketingOptIn += 1;
    if (row.hasActiveConnector) stats.connectedTool += 1;
    if (row.hasPaywallSignal)
      stats.signals[LeadSignalType.ExportPaywallHit] += 1;

    if (!row.onboardingCompleted) continue;
    const d = stats.distributions;
    if (row.persona) d.persona[row.persona] += 1;
    if (row.deliverableType) d.deliverableType[row.deliverableType] += 1;
    if (row.academicLevel) d.academicLevel[row.academicLevel] += 1;
    if (row.acquisitionChannel) {
      d.acquisitionChannel[row.acquisitionChannel] += 1;
    }
    for (const tool of new Set(row.workTools ?? [])) d.workTools[tool] += 1;
    for (const blocker of new Set(row.blockers ?? [])) d.blockers[blocker] += 1;
  }
  return stats;
}
