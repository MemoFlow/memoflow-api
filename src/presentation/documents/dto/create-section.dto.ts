import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSectionDto {
  @ApiProperty({ example: 'Introduction' })
  @IsString()
  @IsNotEmpty()
  title: string;

  // Allowed to be an empty string — a freshly created section may start
  // with no content; word count is computed server-side either way.
  @ApiProperty({ example: 'Lorem ipsum dolor sit amet.' })
  @IsString()
  content: string;

  @ApiProperty({ example: 'draft', required: false })
  @IsOptional()
  @IsString()
  status?: string;

  // No `order` field: a section's position is always append-on-create;
  // it only ever changes via `PATCH .../sections/reorder`.
}
