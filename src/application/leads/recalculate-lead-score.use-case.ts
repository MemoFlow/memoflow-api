import { Inject, Injectable } from '@nestjs/common';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { LeadSignalType } from '../../domain/leads/lead-enums';
import { LEAD_SCORE_REPOSITORY } from '../../domain/leads/lead-score.repository';
import type { LeadScoreRepository } from '../../domain/leads/lead-score.repository';
import { computeLeadScore } from '../../domain/leads/lead-score';
import { LEAD_SIGNAL_REPOSITORY } from '../../domain/leads/lead-signal.repository';
import type { LeadSignalRepository } from '../../domain/leads/lead-signal.repository';
import { ONBOARDING_PROFILE_REPOSITORY } from '../../domain/leads/onboarding-profile.repository';
import type { OnboardingProfileRepository } from '../../domain/leads/onboarding-profile.repository';

/**
 * The only writer of `lead_scores`. Reads the facts, scores them and stores the
 * result unless a run that started later already stored a newer one.
 */
@Injectable()
export class RecalculateLeadScoreUseCase {
  constructor(
    @Inject(ONBOARDING_PROFILE_REPOSITORY)
    private readonly profiles: OnboardingProfileRepository,
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectors: ConnectorConnectionRepository,
    @Inject(LEAD_SIGNAL_REPOSITORY)
    private readonly signals: LeadSignalRepository,
    @Inject(LEAD_SCORE_REPOSITORY)
    private readonly scores: LeadScoreRepository,
  ) {}

  async execute(userId: string): Promise<void> {
    // Taken before reading so the later-started run wins in `saveIfNewer`.
    const computedAt = new Date();
    const [profile, connectors, signals] = await Promise.all([
      this.profiles.findByUserId(userId),
      this.connectors.findActiveByUser(userId),
      this.signals.findByUserId(userId),
    ]);
    const result = computeLeadScore(
      {
        persona: profile?.persona ?? null,
        dueDate: profile?.dueDate ?? null,
        workTools: profile?.workTools ?? null,
        hasActiveConnector: connectors.length > 0,
        hasPaywallSignal: signals.some(
          (s) => s.type === LeadSignalType.ExportPaywallHit,
        ),
      },
      computedAt,
    );
    await this.scores.saveIfNewer(userId, result, computedAt);
  }
}
