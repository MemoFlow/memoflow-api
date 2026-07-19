import { ApiProperty } from '@nestjs/swagger';
import { TemplateSection } from '../../../domain/templates/template-section.entity';

export class TemplateSectionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  order: number;

  @ApiProperty()
  word_count_min: number;

  @ApiProperty()
  word_count_max: number;

  @ApiProperty()
  is_required: boolean;

  static fromEntity(section: TemplateSection): TemplateSectionResponseDto {
    const dto = new TemplateSectionResponseDto();
    dto.id = section.id;
    dto.title = section.title;
    dto.order = section.order;
    dto.word_count_min = section.wordCountMin;
    dto.word_count_max = section.wordCountMax;
    dto.is_required = section.isRequired;
    return dto;
  }
}
