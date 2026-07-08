import { ApiProperty } from '@nestjs/swagger';
import { Section } from '../../../domain/documents/section.entity';

export class SectionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  document_id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  content: string;

  @ApiProperty()
  order: number;

  @ApiProperty()
  status: string;

  @ApiProperty()
  word_count: number;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  static fromEntity(section: Section): SectionResponseDto {
    const dto = new SectionResponseDto();
    dto.id = section.id;
    dto.document_id = section.documentId;
    dto.title = section.title;
    dto.content = section.content;
    dto.order = section.order;
    dto.status = section.status;
    dto.word_count = section.wordCount;
    dto.created_at = section.createdAt;
    dto.updated_at = section.updatedAt;
    return dto;
  }
}
