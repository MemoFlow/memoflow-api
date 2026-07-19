import { ApiProperty } from '@nestjs/swagger';
import { Milestone } from '../../../domain/gamification/milestone.entity';

export class MilestoneResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  document_id: string;

  @ApiProperty()
  milestone_type: string;

  @ApiProperty()
  xp_awarded: number;

  @ApiProperty()
  created_at: Date;

  static fromEntity(milestone: Milestone): MilestoneResponseDto {
    const dto = new MilestoneResponseDto();
    dto.id = milestone.id;
    dto.document_id = milestone.documentId;
    dto.milestone_type = milestone.milestoneType;
    dto.xp_awarded = milestone.xpAwarded;
    dto.created_at = milestone.createdAt;
    return dto;
  }
}
