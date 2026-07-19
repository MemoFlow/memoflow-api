import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveVersionDto {
  @ApiPropertyOptional({ example: 'Before the client rewrite' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}
