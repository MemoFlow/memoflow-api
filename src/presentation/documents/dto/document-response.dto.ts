import { ApiProperty } from '@nestjs/swagger';
import { Document } from '../../../domain/documents/document.entity';

export class DocumentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  user_id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  doc_type: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  style_config: Record<string, unknown>;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  static fromEntity(document: Document): DocumentResponseDto {
    const dto = new DocumentResponseDto();
    dto.id = document.id;
    dto.user_id = document.userId;
    dto.title = document.title;
    dto.doc_type = document.docType;
    dto.status = document.status;
    dto.style_config = document.styleConfig;
    dto.created_at = document.createdAt;
    dto.updated_at = document.updatedAt;
    return dto;
  }
}
