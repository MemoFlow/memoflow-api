import { ApiProperty } from '@nestjs/swagger';
import { JobStatus, PlanningJob } from '../../../domain/context/planning-job';

/**
 * Response DTO for `planning_jobs`. Only exposes the fields this branch's
 * subset skeleton populates (see docs/database-schema.md) — no
 * `prompt_version`/`context_used`, those arrive with roadmap item 5.
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

  @ApiProperty({ nullable: true, type: Object })
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
    dto.result = job.result;
    dto.error_code = job.errorCode;
    dto.error_message = job.errorMessage;
    dto.created_at = job.createdAt;
    dto.started_at = job.startedAt;
    dto.finished_at = job.finishedAt;
    return dto;
  }
}
