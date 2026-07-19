import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateSuggestionDto {
  // Free-form (not @IsIn-restricted) so new prompt feature types can be
  // seeded without a code change here — the 404 from "no active prompt
  // configured for this feature type" is the real guard against typos.
  @ApiProperty({
    example: 'suggestion',
    description: 'Must match the `feature_type` of an active prompt.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  featureType: string;
}
