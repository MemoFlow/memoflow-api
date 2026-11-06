import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SubmitPlanningJobDto {
  @ApiProperty({
    example: 'Draft an outline for chapter 3',
    minLength: 1,
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5000)
  prompt: string;

  @ApiPropertyOptional({
    example: ['notion', 'github'],
    description:
      'Providers of your active connections to gather context from (e.g. "notion"), at most 10, each at most 64 characters. 400 if any is not one of your active connections.',
    maxItems: 10,
    maxLength: 64,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
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
