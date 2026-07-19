import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
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
