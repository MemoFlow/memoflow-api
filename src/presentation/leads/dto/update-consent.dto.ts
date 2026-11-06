import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { RawValue } from './submit-onboarding.dto';

export class UpdateConsentDto {
  @ApiProperty({ description: 'Explicit boolean; strings are rejected.' })
  @RawValue()
  @IsBoolean()
  marketing_opt_in: boolean;
}
