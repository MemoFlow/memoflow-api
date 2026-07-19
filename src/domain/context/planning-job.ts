/**
 * Domain entity for `planning_jobs` (see docs/database-schema.md).
 * Plain TypeScript — no mongoose imports.
 *
 * `document_id`/`section_id` are set at submission time (roadmap item 5)
 * once ownership has been validated by `SubmitPlanningJobUseCase`.
 * `prompt_version`/`context_used` are recorded by `ProcessPlanningJobUseCase`
 * once the job runs — both `null` until then.
 *
 * `Gathering`/`Planning` were added by the RabbitMQ context-engine transport
 * (`docs/contracts/context-engine.md` §4). DECISION: `Running` is KEPT, not
 * dropped — it remains the status used by the legacy synchronous HTTP/stub
 * path (`ProcessPlanningJobUseCase`'s in-process gather+plan, still active
 * when `RABBITMQ_URL` is unset). The queue-transport path never sets
 * `Running`; it moves `pending -> gathering -> planning ->
 * completed/failed`.
 */
export enum JobStatus {
  Pending = 'pending',
  Running = 'running',
  Gathering = 'gathering',
  Planning = 'planning',
  Completed = 'completed',
  Failed = 'failed',
}

/** One accumulated `data` chunk from the context engine, persisted durably so
 * a terminal `completed` chunk can assemble the full context without
 * replaying the RabbitMQ stream. See `PlanningJobRepository.appendResultChunk`. */
export interface AccumulatedDataChunk {
  sequence: number;
  provider: string;
  content: string;
  tokenEstimate: number | null;
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
  /** Data chunks accumulated so far via the RabbitMQ transport's
   * `ctx.gather.results` consumer — always `[]` for jobs that never went
   * through that path (e.g. the legacy HTTP/stub path). */
  dataChunks: AccumulatedDataChunk[];

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
    dataChunks?: AccumulatedDataChunk[];
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
    this.dataChunks = props.dataChunks ?? [];
  }
}
