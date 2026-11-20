import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DOC_TYPES } from '../../../domain/documents/doc-types';
import {
  MAX_JSON_OBJECT_BYTES,
  MaxJsonSize,
} from '../../../shared/validators/max-json-size.validator';

export class CreateDocumentDto {
  @ApiProperty({ example: 'Q3 Planning Doc', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'planning', enum: DOC_TYPES })
  @IsString()
  @IsIn(DOC_TYPES)
  docType: string;

  @ApiProperty({ example: 'draft', required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @ApiProperty({
    example: {},
    required: false,
    description: `Free-form object, at most ${MAX_JSON_OBJECT_BYTES} bytes serialized`,
  })
  @IsOptional()
  @IsObject()
  @MaxJsonSize()
  styleConfig?: Record<string, unknown>;
}
