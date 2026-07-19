import { ApiProperty } from '@nestjs/swagger';
import { Template } from '../../../domain/templates/template.entity';
import { TemplateSectionResponseDto } from './template-section-response.dto';

export class TemplateResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  doc_type: string;

  @ApiProperty()
  scope: string;

  @ApiProperty({ nullable: true })
  created_by: string | null;

  @ApiProperty({ nullable: true })
  style_config: Record<string, unknown> | null;

  @ApiProperty()
  is_published: boolean;

  @ApiProperty({ type: [TemplateSectionResponseDto] })
  sections: TemplateSectionResponseDto[];

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  static fromEntity(template: Template): TemplateResponseDto {
    const dto = new TemplateResponseDto();
    dto.id = template.id;
    dto.title = template.title;
    dto.doc_type = template.docType;
    dto.scope = template.scope;
    dto.created_by = template.createdBy;
    dto.style_config = template.styleConfig;
    dto.is_published = template.isPublished;
    dto.sections = [...template.sections]
      .sort((a, b) => a.order - b.order)
      .map((section) => TemplateSectionResponseDto.fromEntity(section));
    dto.created_at = template.createdAt;
    dto.updated_at = template.updatedAt;
    return dto;
  }
}
