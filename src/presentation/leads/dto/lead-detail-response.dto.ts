import { ApiProperty } from '@nestjs/swagger';
import { LeadDetailResult } from '../../../application/leads/get-lead.use-case';
import { ConnectorProvider } from '../../../domain/connectors/connector-provider';
import { LeadSignalType, ScoreRule } from '../../../domain/leads/lead-enums';
import { LeadSummaryResponseDto } from './lead-summary-response.dto';
import { OnboardingResponseDto } from './onboarding-response.dto';

export class ScoreBreakdownEntryDto {
  @ApiProperty({ enum: ScoreRule }) rule: ScoreRule;
  @ApiProperty() points: number;
}

export class LeadSignalResponseDto {
  @ApiProperty({ enum: LeadSignalType }) type: LeadSignalType;
  @ApiProperty() first_seen_at: string;
  @ApiProperty() last_seen_at: string;
  @ApiProperty() occurrences: number;
}

export class LeadDetailResponseDto extends LeadSummaryResponseDto {
  @ApiProperty({ type: [ScoreBreakdownEntryDto] })
  breakdown: ScoreBreakdownEntryDto[];
  @ApiProperty({ type: OnboardingResponseDto })
  onboarding: OnboardingResponseDto;
  @ApiProperty({ enum: ConnectorProvider, isArray: true })
  active_connectors: ConnectorProvider[];
  @ApiProperty({ type: [LeadSignalResponseDto] })
  signals: LeadSignalResponseDto[];

  static fromResult(result: LeadDetailResult): LeadDetailResponseDto {
    const dto = new LeadDetailResponseDto();
    dto.fill(result.lead);
    dto.breakdown = result.lead.breakdown.map((e) => ({
      rule: e.rule,
      points: e.points,
    }));
    dto.onboarding = OnboardingResponseDto.fromProfile(result.onboarding);
    dto.active_connectors = result.activeConnectors;
    dto.signals = result.signals.map((s) => ({
      type: s.type,
      first_seen_at: s.firstSeenAt.toISOString(),
      last_seen_at: s.lastSeenAt.toISOString(),
      occurrences: s.occurrences,
    }));
    return dto;
  }
}
