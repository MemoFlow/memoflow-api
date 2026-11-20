import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DOC_TYPES } from '../../../domain/documents/doc-types';
import { DEFAULT_STORAGE_LIMITS } from '../../../domain/limits/storage-limits';
import { TEMPLATE_SCOPES } from '../../../domain/templates/template-scopes';
import {
  MAX_JSON_OBJECT_BYTES,
  MaxJsonSize,
} from '../../../shared/validators/max-json-size.validator';
import {
  UniqueSectionOrders,
  WordCountRangeValid,
} from './template-section.validators';

export class TemplateSectionDto {
  @ApiProperty({ example: 'Introduction', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 0, maximum: 10_000 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  order: number;

  @ApiProperty({ example: 50, maximum: 100_000 })
  @IsInt()
  @Min(0)
  @Max(100_000)
  wordCountMin: number;

  @ApiProperty({ example: 200, maximum: 100_000 })
  @IsInt()
  @Min(0)
  @Max(100_000)
  @WordCountRangeValid()
  wordCountMax: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    description:
      'Bullet hints for what the section should cover (max 50 items of 2000 characters). Stored on the template only; not copied into documents.',
    example: ['Context and problem statement', 'Announce the plan'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  keyPoints?: string[];

  @ApiPropertyOptional({
    maxLength: 5000,
    description:
      'Free-text writing guidance for the section. Stored on the template only; not copied into documents.',
    example: 'Keep it to one page.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  guidance?: string;
}

export class CreateTemplateDto {
  @ApiProperty({ example: 'Standard Blog Post', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'blog', enum: DOC_TYPES })
  @IsString()
  @IsIn(DOC_TYPES)
  docType: string;

  @ApiProperty({
    example: 'personal',
    enum: TEMPLATE_SCOPES,
    description: "'global' is admin-only (403 otherwise)",
  })
  @IsString()
  @IsIn(TEMPLATE_SCOPES)
  scope: string;

  @ApiPropertyOptional({
    example: {},
    description: `Free-form object, at most ${MAX_JSON_OBJECT_BYTES} bytes serialized`,
  })
  @IsOptional()
  @IsObject()
  @MaxJsonSize()
  styleConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiProperty({
    type: [TemplateSectionDto],
    minItems: 1,
    maxItems: DEFAULT_STORAGE_LIMITS.maxSectionsPerDocument,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DEFAULT_STORAGE_LIMITS.maxSectionsPerDocument)
  @ValidateNested({ each: true })
  @Type(() => TemplateSectionDto)
  @UniqueSectionOrders()
  sections: TemplateSectionDto[];
}
