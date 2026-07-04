import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class SubmitPlanningJobDto {
  @ApiProperty({ example: 'Draft an outline for chapter 3' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  prompt: string;

  @ApiPropertyOptional({
    example: ['notion', 'github'],
    description:
      'Connector ids to gather context from (unused until roadmap item 7).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  connectors?: string[];
}
