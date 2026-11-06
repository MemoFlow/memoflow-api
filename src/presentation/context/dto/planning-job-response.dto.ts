import { ApiProperty } from '@nestjs/swagger';
import { JobStatus, PlanningJob } from '../../../domain/context/planning-job';

/**
 * Response DTO for `planning_jobs` (see docs/database-schema.md).
 * `document_id`/`section_id`/`prompt_version`/`context_used` arrive with
 * roadmap item 5 (AI layer).
 */
export class PlanningJobResponseDto {
  @ApiProperty()
  job_id: string;

  @ApiProperty({ enum: JobStatus })
  status: JobStatus;

  @ApiProperty()
  prompt: string;

  @ApiProperty({ type: [String] })
  connectors: string[];

  @ApiProperty({ nullable: true })
  document_id: string | null;

  @ApiProperty({ nullable: true })
  section_id: string | null;

  @ApiProperty({ nullable: true })
  prompt_version: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Model that served the planning call, when known.',
  })
  model: string | null;

  @ApiProperty({
    nullable: true,
    type: Object,
    description:
      'Context recorded for the run: the connector context as gathered, plus `retrieval` ' +
      '({ sources: { id, type, title, ref, truncated }[], matched, used, dropped, truncated, failed }). ' +
      '`retrieval` is metadata only (`ref` is a section id or a provider); retrieved section text is never stored.',
  })
  context_used: Record<string, unknown> | null;

  @ApiProperty({
    nullable: true,
    type: Object,
    description:
      '{ suggestions: string[], outline: string | null, sources: { id, type, title }[] }. ' +
      '`sources` lists only the numbered sources the plan cites ("S1", ...; `type` is "section" or "connector"), ' +
      'never their text; inline [S1] citations of unknown sources are removed.',
  })
  result: Record<string, unknown> | null;

  @ApiProperty({ nullable: true })
  error_code: string | null;

  @ApiProperty({ nullable: true })
  error_message: string | null;

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ nullable: true })
  started_at: Date | null;

  @ApiProperty({ nullable: true })
  finished_at: Date | null;

  static fromDomain(job: PlanningJob): PlanningJobResponseDto {
    const dto = new PlanningJobResponseDto();
    dto.job_id = job.id;
    dto.status = job.status;
    dto.prompt = job.prompt;
    dto.connectors = job.connectors;
    dto.document_id = job.documentId;
    dto.section_id = job.sectionId;
    dto.prompt_version = job.promptVersion;
    dto.model = job.model;
    dto.context_used = job.contextUsed;
    dto.result = job.result;
    dto.error_code = job.errorCode;
    dto.error_message = job.errorMessage;
    dto.created_at = job.createdAt;
    dto.started_at = job.startedAt;
    dto.finished_at = job.finishedAt;
    return dto;
  }
}
