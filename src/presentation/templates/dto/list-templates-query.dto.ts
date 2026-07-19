import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListTemplatesQueryDto {
  @ApiPropertyOptional({ example: 'blog' })
  @IsOptional()
  @IsString()
  docType?: string;

  @ApiPropertyOptional({ example: 'personal' })
  @IsOptional()
  @IsString()
  scope?: string;
}
