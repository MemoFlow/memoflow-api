import { ApiProperty } from '@nestjs/swagger';
import { LeadStats } from '../../../domain/leads/lead-stats';

// Dynamic zero-filled maps keyed by enum values; documented as free-form
// objects in Swagger, shape pinned by the e2e spec and the contract.
const MAP = {
  type: 'object' as const,
  additionalProperties: { type: 'number' },
};

export class LeadStatsResponseDto {
  @ApiProperty() generated_at: string;
  @ApiProperty() total_leads: number;
  @ApiProperty(MAP) tiers: Record<string, number>;
  @ApiProperty(MAP) suggested_actions: Record<string, number>;
  @ApiProperty(MAP) onboarding: { not_started: number; completed: number };
  @ApiProperty() marketing_opt_in: number;
  @ApiProperty() connected_tool: number;
  @ApiProperty(MAP) signals: Record<string, number>;
  @ApiProperty({ type: 'object', additionalProperties: MAP })
  distributions: {
    persona: Record<string, number>;
    deliverable_type: Record<string, number>;
    academic_level: Record<string, number>;
    work_tools: Record<string, number>;
    blockers: Record<string, number>;
    acquisition_channel: Record<string, number>;
  };

  static fromStats(stats: LeadStats): LeadStatsResponseDto {
    const dto = new LeadStatsResponseDto();
    dto.generated_at = stats.generatedAt;
    dto.total_leads = stats.totalLeads;
    dto.tiers = { ...stats.tiers };
    dto.suggested_actions = { ...stats.suggestedActions };
    dto.onboarding = {
      not_started: stats.onboarding.notStarted,
      completed: stats.onboarding.completed,
    };
    dto.marketing_opt_in = stats.marketingOptIn;
    dto.connected_tool = stats.connectedTool;
    dto.signals = { ...stats.signals };
    const d = stats.distributions;
    dto.distributions = {
      persona: { ...d.persona },
      deliverable_type: { ...d.deliverableType },
      academic_level: { ...d.academicLevel },
      work_tools: { ...d.workTools },
      blockers: { ...d.blockers },
      acquisition_channel: { ...d.acquisitionChannel },
    };
    return dto;
  }
}
