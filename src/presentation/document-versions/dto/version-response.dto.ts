import { ApiProperty } from '@nestjs/swagger';
import {
  DocumentVersion,
  SectionSnapshot,
} from '../../../domain/document-versions/document-version.entity';

export class SectionSnapshotResponseDto {
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

  static fromDomain(snapshot: SectionSnapshot): SectionSnapshotResponseDto {
    const dto = new SectionSnapshotResponseDto();
    dto.title = snapshot.title;
    dto.content = snapshot.content;
    dto.order = snapshot.order;
    dto.status = snapshot.status;
    dto.word_count = snapshot.wordCount;
    return dto;
  }
}

/** Full snapshot response — includes `sections_snapshot`. */
export class VersionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  document_id: string;

  @ApiProperty()
  user_id: string;

  @ApiProperty()
  version: number;

  @ApiProperty({ nullable: true })
  label: string | null;

  @ApiProperty({ type: [SectionSnapshotResponseDto] })
  sections_snapshot: SectionSnapshotResponseDto[];

  @ApiProperty()
  saved_at: Date;

  static fromDomain(version: DocumentVersion): VersionResponseDto {
    const dto = new VersionResponseDto();
    dto.id = version.id;
    dto.document_id = version.documentId;
    dto.user_id = version.userId;
    dto.version = version.version;
    dto.label = version.label;
    dto.sections_snapshot = version.sectionsSnapshot.map((snapshot) =>
      SectionSnapshotResponseDto.fromDomain(snapshot),
    );
    dto.saved_at = version.savedAt;
    return dto;
  }
}
