import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateSuggestionDto {
  // Not @IsIn-restricted: an unknown or internal type (e.g. `planning`)
  // gets the same 404 as a type with no active prompt.
  @ApiProperty({
    example: 'suggestion',
    enum: ['suggestion', 'rewrite', 'summarize', 'expand'],
    description:
      'One of suggestion, rewrite, summarize, expand. Any other value, including internal types, returns 404.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  featureType: string;
}
