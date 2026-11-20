import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Upper bound on a section's body, in characters. */
export const MAX_SECTION_CONTENT_LENGTH = 100_000;

export class CreateSectionDto {
  @ApiProperty({ example: 'Introduction', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  // Allowed to be an empty string — a freshly created section may start
  // with no content; word count is computed server-side either way.
  @ApiProperty({
    example: 'Lorem ipsum dolor sit amet.',
    maxLength: MAX_SECTION_CONTENT_LENGTH,
  })
  @IsString()
  @MaxLength(MAX_SECTION_CONTENT_LENGTH)
  content: string;

  @ApiProperty({ example: 'draft', required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  // No `order` field: a section's position is always append-on-create;
  // it only ever changes via `PATCH .../sections/reorder`.
}
