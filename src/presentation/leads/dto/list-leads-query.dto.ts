import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional } from 'class-validator';
import { LeadTier } from '../../../domain/leads/lead-enums';

// Boolean filters are strings on purpose: the global ValidationPipe enables
// implicit conversion, which would turn "false" into `true` for a boolean.
// The controller converts them. `page`/`limit` carry no `@Min`/`@Max`: the
// use-case clamps them.
export class ListLeadsQueryDto {
  @ApiProperty({ required: false, enum: LeadTier })
  @IsOptional()
  @IsEnum(LeadTier)
  tier?: LeadTier;

  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  onboarding_completed?: string;

  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  marketing_opt_in?: string;

  @ApiProperty({
    required: false,
    default: 1,
    description: 'Below 1 is clamped to 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @ApiProperty({
    required: false,
    default: 25,
    description: 'Outside 1..100 is clamped.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
