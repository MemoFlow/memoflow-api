import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListPromptsQueryDto {
  @ApiPropertyOptional({ description: 'Only prompts of this feature type.' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  feature_type?: string;
}
