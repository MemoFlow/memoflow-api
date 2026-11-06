import { ApiProperty } from '@nestjs/swagger';
import { Prompt } from '../../../domain/ai/prompt.entity';

export class PromptResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  feature_type: string;

  @ApiProperty()
  version: string;

  @ApiProperty()
  system_template: string;

  @ApiProperty({ description: 'The user message template.' })
  user_template: string;

  @ApiProperty()
  user_invocable: boolean;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  static fromDomain(prompt: Prompt): PromptResponseDto {
    const dto = new PromptResponseDto();
    dto.id = prompt.id;
    dto.feature_type = prompt.featureType;
    dto.version = prompt.version;
    dto.system_template = prompt.systemTemplate;
    dto.user_template = prompt.template;
    dto.user_invocable = prompt.userInvocable;
    dto.is_active = prompt.isActive;
    dto.created_at = prompt.createdAt;
    dto.updated_at = prompt.updatedAt;
    return dto;
  }
}
