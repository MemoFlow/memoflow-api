import { Inject, Injectable } from '@nestjs/common';
import { PROMPT_REPOSITORY } from '../../domain/ai/prompt.repository';
import type { PromptRepository } from '../../domain/ai/prompt.repository';
import {
  ContextResultChunk,
  isTerminalPhase,
} from '../../domain/context/context-result-chunk';
import { LLM_PLANNER } from '../../domain/context/llm-planner.port';
import type {
  LlmPlanner,
  PlanningResult,
} from '../../domain/context/llm-planner.port';
import {
  AccumulatedDataChunk,
  JobStatus,
  PlanningJob,
} from '../../domain/context/planning-job';
import { PLANNING_JOB_REPOSITORY } from '../../domain/context/planning-job.repository';
import type {
  AppendResultChunkData,
  PlanningJobRepository,
} from '../../domain/context/planning-job.repository';

/** Feature type of the active prompt whose version is recorded on the job —
 * mirrors `ProcessPlanningJobUseCase`. */
const PLANNING_FEATURE_TYPE = 'planning';

export interface HandleContextResultChunkInput {
  chunk: ContextResultChunk;
}

export type HandleContextResultChunkOutcome =
  /** Newly recorded — durably persisted (and, for a terminal chunk,
   * finalized). The caller (the AMQP consumer) relays it and acks. */
  | 'applied'
  /** `(job_id, sequence)` already recorded, or the job was already terminal
   * — a safe no-op. The caller acks without relaying anything new. */
  | 'duplicate'
  /** `job_id` doesn't match any `planning_jobs` row — unrecoverable; the
   * caller nacks (no requeue) so it lands in the results DLQ. */
  | 'unknown-job'
  /** The job exists but its `user_id` doesn't match the chunk's — a data
   * integrity violation, never trusted; unrecoverable, same DLQ handling as
   * `unknown-job`. */
  | 'ownership-mismatch';

export interface HandleContextResultChunkResult {
  outcome: HandleContextResultChunkOutcome;
  job: PlanningJob | null;
  chunk: ContextResultChunk;
  /** `true` only when this call itself finalized the job (a newly-applied
   * terminal `completed`/`failed` status chunk) — the caller (the AMQP
   * consumer, which owns all `EventEmitter2` relaying, mirroring
   * `PlanningProcessor`) uses this to decide which WebSocket events to emit. */
  terminal: boolean;
}

/**
 * Handles one `ctx.gather.results` chunk (`docs/contracts/context-engine.md`
 * §3-4): validates the chunk belongs to a real job it's allowed to touch,
 * durably + idempotently persists it, and — on the terminal `completed`
 * status chunk — assembles the accumulated context, runs the existing LLM
 * planner port, and completes the job; on terminal `failed`, fails it.
 *
 * Framework-pure by the same convention as `ProcessPlanningJobUseCase`: no
 * `amqplib`/`EventEmitter2` import here — `ContextResultsConsumer` (the
 * infrastructure adapter) parses/validates the raw AMQP message, calls this
 * use-case, then acks/nacks and emits the `planning.*` WebSocket relay
 * events based on the returned outcome.
 */
@Injectable()
export class HandleContextResultChunkUseCase {
  constructor(
    @Inject(PLANNING_JOB_REPOSITORY)
    private readonly planningJobRepository: PlanningJobRepository,
    @Inject(LLM_PLANNER)
    private readonly llmPlanner: LlmPlanner,
    @Inject(PROMPT_REPOSITORY)
    private readonly promptRepository: PromptRepository,
  ) {}

  async execute(
    input: HandleContextResultChunkInput,
  ): Promise<HandleContextResultChunkResult> {
    const { chunk } = input;

    const job = await this.planningJobRepository.findById(chunk.jobId);
    if (!job) {
      return { outcome: 'unknown-job', job: null, chunk, terminal: false };
    }
    if (job.userId !== chunk.userId) {
      return { outcome: 'ownership-mismatch', job, chunk, terminal: false };
    }

    // Already terminal — any further chunk (even a fresh, never-seen
    // sequence) is a no-op. Never re-run gather/plan or re-finalize a
    // completed/failed job.
    if (job.status === JobStatus.Completed || job.status === JobStatus.Failed) {
      return { outcome: 'duplicate', job, chunk, terminal: false };
    }

    const appendData: AppendResultChunkData =
      chunk.type === 'data'
        ? {
            sequence: chunk.sequence,
            type: 'data',
            data: {
              provider: chunk.data.provider,
              content: chunk.data.content,
              tokenEstimate: chunk.data.tokenEstimate ?? null,
            },
          }
        : { sequence: chunk.sequence, type: 'status' };

    const { applied, job: afterAppend } =
      await this.planningJobRepository.appendResultChunk(job.id, appendData);
    if (!applied) {
      return {
        outcome: 'duplicate',
        job: afterAppend ?? job,
        chunk,
        terminal: false,
      };
    }
    // `applied: true` always returns the updated job.
    const current = afterAppend ?? job;

    if (chunk.type === 'data') {
      return { outcome: 'applied', job: current, chunk, terminal: false };
    }

    if (!isTerminalPhase(chunk.status.phase)) {
      // Non-terminal status chunk (started/gathering) — a progress signal
      // only, no job-status transition.
      return { outcome: 'applied', job: current, chunk, terminal: false };
    }

    // Finalization itself is the race-safety boundary — NOT a pre-read of
    // `current.status`. `finalizeCompleted`/`finalizeFailed` go straight to
    // an atomic repository CAS (`claimForPlanning`/`failIfStillGathering`,
    // both guarded on `status === gathering`), so a CE bug emitting two
    // distinct-sequence terminal chunks (or one racing the no-result
    // timeout) can only ever have one winner — the loser gets `null` back
    // and is a no-op below, never a second finalize/relay.
    const finalized =
      chunk.status.phase === 'completed'
        ? await this.finalizeCompleted(current)
        : await this.finalizeFailed(current, chunk.status);

    if (!finalized) {
      return { outcome: 'duplicate', job: current, chunk, terminal: false };
    }

    return { outcome: 'applied', job: finalized, chunk, terminal: true };
  }

  private async finalizeCompleted(
    job: PlanningJob,
  ): Promise<PlanningJob | null> {
    const contextUsed = this.assembleContext(job.dataChunks);

    // Atomic CAS: gathering -> planning, recording the assembled context.
    // `null` means this call lost the race — some other winner already
    // claimed the job (see the race-safety note in `execute` above).
    const claimed = await this.planningJobRepository.claimForPlanning(
      job.id,
      contextUsed,
    );
    if (!claimed) {
      return null;
    }

    const activePrompt = await this.promptRepository.findActiveByFeatureType(
      PLANNING_FEATURE_TYPE,
    );
    const promptVersion = activePrompt?.version ?? null;

    let result: PlanningResult;
    try {
      result = await this.llmPlanner.plan({
        prompt: claimed.prompt,
        context: contextUsed,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Planning failed after context gather completed';
      const failed = await this.planningJobRepository.updateStatus(claimed.id, {
        status: JobStatus.Failed,
        errorCode: 'PROCESSING_FAILED',
        errorMessage,
        finishedAt: new Date(),
        promptVersion,
        contextUsed,
      });
      return (
        failed ?? {
          ...claimed,
          status: JobStatus.Failed,
          errorMessage,
          promptVersion,
          contextUsed,
        }
      );
    }

    const resultDoc: Record<string, unknown> = { ...result };
    const completed = await this.planningJobRepository.updateStatus(
      claimed.id,
      {
        status: JobStatus.Completed,
        result: resultDoc,
        finishedAt: new Date(),
        promptVersion,
        contextUsed,
      },
    );
    return (
      completed ?? {
        ...claimed,
        status: JobStatus.Completed,
        result: resultDoc,
        promptVersion,
        contextUsed,
      }
    );
  }

  private finalizeFailed(
    job: PlanningJob,
    status: { errorCode?: string; message?: string },
  ): Promise<PlanningJob | null> {
    const errorCode = status.errorCode ?? 'CONTEXT_ENGINE_FAILED';
    const errorMessage = status.message ?? 'Context gather failed';
    // Atomic CAS (same guard as `claimForPlanning`, failure side) — `null`
    // means this call lost the race.
    return this.planningJobRepository.failIfStillGathering(job.id, {
      errorCode,
      errorMessage,
    });
  }

  private assembleContext(
    dataChunks: AccumulatedDataChunk[],
  ): Record<string, unknown> {
    const sorted = [...dataChunks].sort((a, b) => a.sequence - b.sequence);
    return {
      chunks: sorted.map((c) => ({
        provider: c.provider,
        content: c.content,
        tokenEstimate: c.tokenEstimate,
      })),
    };
  }
}
