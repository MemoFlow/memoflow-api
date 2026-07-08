import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderSectionsDto {
  @ApiProperty({
    type: [String],
    description:
      "The document's section ids in their new order — must be exactly the set of the document's existing section ids.",
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  sectionIds: string[];
}
