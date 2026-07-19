/**
 * Domain entity for `planning_jobs` (see docs/database-schema.md).
 * Plain TypeScript — no mongoose imports.
 *
 * `document_id`/`section_id` are set at submission time (roadmap item 5)
 * once ownership has been validated by `SubmitPlanningJobUseCase`.
 * `prompt_version`/`context_used` are recorded by `ProcessPlanningJobUseCase`
 * once the job runs — both `null` until then.
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
  promptVersion: string | null;
  contextUsed: Record<string, unknown> | null;
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
    promptVersion?: string | null;
    contextUsed?: Record<string, unknown> | null;
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
    this.promptVersion = props.promptVersion ?? null;
    this.contextUsed = props.contextUsed ?? null;
    this.result = props.result;
    this.errorCode = props.errorCode;
    this.errorMessage = props.errorMessage;
    this.createdAt = props.createdAt;
    this.startedAt = props.startedAt;
    this.finishedAt = props.finishedAt;
  }
}
