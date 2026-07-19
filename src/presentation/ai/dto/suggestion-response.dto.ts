import { ApiProperty } from '@nestjs/swagger';
import {
  AiSuggestion,
  SuggestionStatus,
} from '../../../domain/ai/ai-suggestion.entity';

export class SuggestionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  section_id: string;

  @ApiProperty()
  user_id: string;

  @ApiProperty()
  feature_type: string;

  @ApiProperty()
  original_text: string;

  @ApiProperty()
  suggested_text: string;

  @ApiProperty({ enum: SuggestionStatus })
  status: SuggestionStatus;

  @ApiProperty()
  prompt_version: string;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  static fromDomain(suggestion: AiSuggestion): SuggestionResponseDto {
    const dto = new SuggestionResponseDto();
    dto.id = suggestion.id;
    dto.section_id = suggestion.sectionId;
    dto.user_id = suggestion.userId;
    dto.feature_type = suggestion.featureType;
    dto.original_text = suggestion.originalText;
    dto.suggested_text = suggestion.suggestedText;
    dto.status = suggestion.status;
    dto.prompt_version = suggestion.promptVersion;
    dto.created_at = suggestion.createdAt;
    dto.updated_at = suggestion.updatedAt;
    return dto;
  }
}
