/**
 * Domain entity for `planning_jobs` (see docs/database-schema.md).
 * Plain TypeScript — no mongoose imports.
 *
 * This branch (context-queue-infra) ships the foundation subset only:
 * `document_id`/`section_id` stay null until document/section linkage
 * (roadmap item 2) lands, and `connectors`/`result` are populated by the
 * (later) processing use-case — this slice only creates/reads the shell.
 */
export enum JobStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

export class PlanningJob {
  id: string;
  userId: string;
  documentId: string | null;
  sectionId: string | null;
  status: JobStatus;
  prompt: string;
  connectors: string[];
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;

  constructor(props: {
    id: string;
    userId: string;
    documentId: string | null;
    sectionId: string | null;
    status: JobStatus;
    prompt: string;
    connectors: string[];
    result: Record<string, unknown> | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }) {
    this.id = props.id;
    this.userId = props.userId;
    this.documentId = props.documentId;
    this.sectionId = props.sectionId;
    this.status = props.status;
    this.prompt = props.prompt;
    this.connectors = props.connectors;
    this.result = props.result;
    this.errorCode = props.errorCode;
    this.errorMessage = props.errorMessage;
    this.createdAt = props.createdAt;
    this.startedAt = props.startedAt;
    this.finishedAt = props.finishedAt;
  }
}
