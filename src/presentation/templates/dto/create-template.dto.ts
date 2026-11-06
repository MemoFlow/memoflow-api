import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  UniqueSectionOrders,
  WordCountRangeValid,
} from './template-section.validators';

export class TemplateSectionDto {
  @ApiProperty({ example: 'Introduction' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  order: number;

  @ApiProperty({ example: 50 })
  @IsInt()
  @Min(0)
  wordCountMin: number;

  @ApiProperty({ example: 200 })
  @IsInt()
  @Min(0)
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
  @ApiProperty({ example: 'Standard Blog Post' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'blog' })
  @IsString()
  @IsNotEmpty()
  docType: string;

  @ApiProperty({ example: 'personal' })
  @IsString()
  @IsNotEmpty()
  scope: string;

  @ApiPropertyOptional({ example: {} })
  @IsOptional()
  @IsObject()
  styleConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiProperty({ type: [TemplateSectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TemplateSectionDto)
  @UniqueSectionOrders()
  sections: TemplateSectionDto[];
}
