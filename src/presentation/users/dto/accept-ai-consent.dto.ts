import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class AcceptAiConsentDto {
  @ApiProperty({
    example: '2026-11-06',
    description:
      'The AI notice version being accepted; must equal the current version (409 otherwise)',
  })
  @IsString()
  @MaxLength(64)
  version: string;
}
