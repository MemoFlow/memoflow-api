import { ApiProperty } from '@nestjs/swagger';
import {
  LeadTier,
  Persona,
  SuggestedAction,
} from '../../../domain/leads/lead-enums';
import { LeadRow } from '../../../domain/leads/lead-read.repository';
import { suggestedAction } from '../../../domain/leads/lead-score';

export class LeadSummaryResponseDto {
  @ApiProperty() user_id: string;
  @ApiProperty() email: string;
  @ApiProperty() display_name: string;
  @ApiProperty() score: number;
  @ApiProperty({ enum: LeadTier }) tier: LeadTier;
  @ApiProperty({ enum: SuggestedAction }) suggested_action: SuggestedAction;
  @ApiProperty({ nullable: true, type: String })
  score_computed_at: string | null;
  @ApiProperty() onboarding_completed: boolean;
  @ApiProperty({ enum: Persona, nullable: true }) persona: Persona | null;
  @ApiProperty({ nullable: true, type: String }) due_date: string | null;
  @ApiProperty() marketing_opt_in: boolean;
  @ApiProperty() registered_at: string;
  @ApiProperty({ nullable: true, type: String })
  last_active_at: string | null;

  protected fill(row: LeadRow): void {
    this.user_id = row.userId;
    this.email = row.email;
    this.display_name = row.displayName;
    this.score = row.score;
    this.tier = row.tier;
    // Derived from the current opt-in, so a consent change shows at once.
    this.suggested_action = suggestedAction(row.tier, row.marketingOptIn);
    this.score_computed_at = row.scoreComputedAt?.toISOString() ?? null;
    this.onboarding_completed = row.onboardingCompleted;
    this.persona = row.persona;
    this.due_date = row.dueDate;
    this.marketing_opt_in = row.marketingOptIn;
    this.registered_at = row.registeredAt.toISOString();
    this.last_active_at = row.lastActiveAt?.toISOString() ?? null;
  }

  static fromRow(row: LeadRow): LeadSummaryResponseDto {
    const dto = new LeadSummaryResponseDto();
    dto.fill(row);
    return dto;
  }
}

export class LeadListResponseDto {
  @ApiProperty({ type: [LeadSummaryResponseDto] })
  items: LeadSummaryResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
