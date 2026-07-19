import { ApiProperty } from '@nestjs/swagger';
import { RestoreVersionResult } from '../../../application/document-versions/restore-version.use-case';

export class RestoreResultDto {
  @ApiProperty()
  document_id: string;

  @ApiProperty()
  version_id: string;

  @ApiProperty()
  version: number;

  @ApiProperty()
  sections_restored: number;

  static fromResult(result: RestoreVersionResult): RestoreResultDto {
    const dto = new RestoreResultDto();
    dto.document_id = result.documentId;
    dto.version_id = result.versionId;
    dto.version = result.version;
    dto.sections_restored = result.sectionsRestored;
    return dto;
  }
}
