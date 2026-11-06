import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { LEAD_READ_REPOSITORY } from '../../domain/leads/lead-read.repository';
import type {
  LeadReadRepository,
  LeadRow,
} from '../../domain/leads/lead-read.repository';
import { LEAD_SIGNAL_REPOSITORY } from '../../domain/leads/lead-signal.repository';
import type { LeadSignalRepository } from '../../domain/leads/lead-signal.repository';
import { LeadSignal } from '../../domain/leads/lead-signal.entity';
import { OnboardingProfile } from '../../domain/leads/onboarding-profile.entity';
import { ONBOARDING_PROFILE_REPOSITORY } from '../../domain/leads/onboarding-profile.repository';
import type { OnboardingProfileRepository } from '../../domain/leads/onboarding-profile.repository';

export interface LeadDetailResult {
  lead: LeadRow;
  onboarding: OnboardingProfile | null;
  activeConnectors: ConnectorProvider[];
  signals: LeadSignal[];
}

@Injectable()
export class GetLeadUseCase {
  constructor(
    @Inject(LEAD_READ_REPOSITORY)
    private readonly leads: LeadReadRepository,
    @Inject(ONBOARDING_PROFILE_REPOSITORY)
    private readonly profiles: OnboardingProfileRepository,
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectors: ConnectorConnectionRepository,
    @Inject(LEAD_SIGNAL_REPOSITORY)
    private readonly signals: LeadSignalRepository,
  ) {}

  /** 404 for unknown, admin and disabled users alike (not leads). */
  async execute(userId: string): Promise<LeadDetailResult> {
    const lead = await this.leads.findEligibleByUserId(userId);
    if (!lead) throw new NotFoundException(`Lead ${userId} not found`);
    const [onboarding, connections, signals] = await Promise.all([
      this.profiles.findByUserId(userId),
      this.connectors.findActiveByUser(userId),
      this.signals.findByUserId(userId),
    ]);
    return {
      lead,
      onboarding,
      activeConnectors: connections.map((c) => c.provider),
      signals,
    };
  }
}
