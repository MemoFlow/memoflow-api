import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DOC_TYPES } from '../../../domain/documents/doc-types';
import { TEMPLATE_SCOPES } from '../../../domain/templates/template-scopes';
import {
  DEFAULT_TEMPLATE_PAGE_SIZE,
  MAX_TEMPLATE_OFFSET,
  MAX_TEMPLATE_PAGE_SIZE,
} from '../../../application/templates/list-templates.use-case';

export class ListTemplatesQueryDto {
  @ApiPropertyOptional({ example: 'blog', enum: DOC_TYPES })
  @IsOptional()
  @IsString()
  @IsIn(DOC_TYPES)
  docType?: string;

  @ApiPropertyOptional({ example: 'personal', enum: TEMPLATE_SCOPES })
  @IsOptional()
  @IsString()
  @IsIn(TEMPLATE_SCOPES)
  scope?: string;

  @ApiPropertyOptional({
    default: DEFAULT_TEMPLATE_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_TEMPLATE_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_TEMPLATE_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    maximum: MAX_TEMPLATE_OFFSET,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_TEMPLATE_OFFSET)
  offset?: number;
}
