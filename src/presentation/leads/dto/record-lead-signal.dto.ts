import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { LeadSignalType } from '../../../domain/leads/lead-enums';

export class RecordLeadSignalDto {
  @ApiProperty({ enum: LeadSignalType })
  @IsEnum(LeadSignalType)
  type: LeadSignalType;
}
