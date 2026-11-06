import { ApiProperty } from '@nestjs/swagger';
import {
  AcademicLevel,
  AcquisitionChannel,
  Blocker,
  DeliverableType,
  Persona,
  WorkTool,
} from '../../../domain/leads/lead-enums';
import { OnboardingProfile } from '../../../domain/leads/onboarding-profile.entity';

export class OnboardingResponseDto {
  @ApiProperty() completed: boolean;
  @ApiProperty({ enum: Persona, nullable: true }) persona: Persona | null;
  @ApiProperty({ enum: DeliverableType, nullable: true })
  deliverable_type: DeliverableType | null;
  @ApiProperty({ nullable: true, type: String }) due_date: string | null;
  @ApiProperty({ enum: AcademicLevel, nullable: true })
  academic_level: AcademicLevel | null;
  @ApiProperty({ nullable: true, type: String }) school_name: string | null;
  @ApiProperty({ enum: WorkTool, isArray: true, nullable: true })
  work_tools: WorkTool[] | null;
  @ApiProperty({ enum: Blocker, isArray: true, nullable: true })
  blockers: Blocker[] | null;
  @ApiProperty({ enum: AcquisitionChannel, nullable: true })
  acquisition_channel: AcquisitionChannel | null;
  @ApiProperty() marketing_opt_in: boolean;
  @ApiProperty({ nullable: true, type: String })
  marketing_opt_in_at: string | null;
  @ApiProperty({ nullable: true, type: String })
  submitted_at: string | null;

  static fromProfile(profile: OnboardingProfile | null): OnboardingResponseDto {
    const dto = new OnboardingResponseDto();
    dto.completed = profile !== null;
    dto.persona = profile?.persona ?? null;
    dto.deliverable_type = profile?.deliverableType ?? null;
    dto.due_date = profile?.dueDate ?? null;
    dto.academic_level = profile?.academicLevel ?? null;
    dto.school_name = profile?.schoolName ?? null;
    dto.work_tools = profile?.workTools ?? null;
    dto.blockers = profile?.blockers ?? null;
    dto.acquisition_channel = profile?.acquisitionChannel ?? null;
    dto.marketing_opt_in = profile?.marketingOptIn ?? false;
    dto.marketing_opt_in_at = profile?.marketingOptInAt.toISOString() ?? null;
    dto.submitted_at = profile?.submittedAt.toISOString() ?? null;
    return dto;
  }
}
