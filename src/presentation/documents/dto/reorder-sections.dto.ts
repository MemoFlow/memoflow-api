import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import { DEFAULT_STORAGE_LIMITS } from '../../../domain/limits/storage-limits';

export class ReorderSectionsDto {
  @ApiProperty({
    type: [String],
    maxItems: DEFAULT_STORAGE_LIMITS.maxSectionsPerDocument,
    description:
      "The document's section ids in their new order — must be exactly the set of the document's existing section ids.",
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(DEFAULT_STORAGE_LIMITS.maxSectionsPerDocument)
  @IsUUID('4', { each: true })
  sectionIds: string[];
}
