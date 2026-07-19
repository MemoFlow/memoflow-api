import { ApiProperty } from '@nestjs/swagger';
import { ApplyTemplateResult } from '../../../application/templates/apply-template.use-case';

export class ApplyTemplateResponseDto {
  @ApiProperty()
  document_template_id: string;

  @ApiProperty()
  document_id: string;

  @ApiProperty()
  template_id: string;

  @ApiProperty()
  applied_at: Date;

  @ApiProperty()
  sections_created: number;

  static fromResult(result: ApplyTemplateResult): ApplyTemplateResponseDto {
    const dto = new ApplyTemplateResponseDto();
    dto.document_template_id = result.documentTemplateId;
    dto.document_id = result.documentId;
    dto.template_id = result.templateId;
    dto.applied_at = result.appliedAt;
    dto.sections_created = result.sectionsCreated;
    return dto;
  }
}
