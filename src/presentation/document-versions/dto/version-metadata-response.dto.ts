import { ApiProperty } from '@nestjs/swagger';
import { DocumentVersionMetadata } from '../../../domain/document-versions/document-version.entity';

/** Metadata-only response for the list endpoint — no `sections_snapshot`. */
export class VersionMetadataResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  document_id: string;

  @ApiProperty()
  version: number;

  @ApiProperty({ nullable: true })
  label: string | null;

  @ApiProperty()
  saved_at: Date;

  @ApiProperty()
  section_count: number;

  static fromDomain(
    metadata: DocumentVersionMetadata,
  ): VersionMetadataResponseDto {
    const dto = new VersionMetadataResponseDto();
    dto.id = metadata.id;
    dto.document_id = metadata.documentId;
    dto.version = metadata.version;
    dto.label = metadata.label;
    dto.saved_at = metadata.savedAt;
    dto.section_count = metadata.sectionCount;
    return dto;
  }
}
