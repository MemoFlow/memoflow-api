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

  @ApiProperty({ type: [String], nullable: true })
  key_points: string[] | null;

  @ApiProperty({ type: String, nullable: true })
  guidance: string | null;

  static fromEntity(section: TemplateSection): TemplateSectionResponseDto {
    const dto = new TemplateSectionResponseDto();
    dto.id = section.id;
    dto.title = section.title;
    dto.order = section.order;
    dto.word_count_min = section.wordCountMin;
    dto.word_count_max = section.wordCountMax;
    dto.is_required = section.isRequired;
    dto.key_points = section.keyPoints;
    dto.guidance = section.guidance;
    return dto;
  }
}
