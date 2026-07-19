import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
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

  @ApiPropertyOptional({
    description:
      'Bind this job to a document you own — 404 if not found/not owned.',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({
    description:
      "Bind this job to a section — 404 if not found, or if it doesn't belong to `documentId` (when both are given).",
  })
  @IsOptional()
  @IsUUID()
  sectionId?: string;
}
