import { Inject, Injectable, Logger } from '@nestjs/common';
import { PROMPT_REPOSITORY } from '../../domain/ai/prompt.repository';
import type { PromptRepository } from '../../domain/ai/prompt.repository';
import {
  ContextResultChunk,
  isTerminalPhase,
} from '../../domain/context/context-result-chunk';
import {
  AccumulatedDataChunk,
  JobStatus,
  PlanningJob,
} from '../../domain/context/planning-job';
import { PLANNING_JOB_REPOSITORY } from '../../domain/context/planning-job.repository';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';
import type { ValidatedPlanningResult } from './planning-citations';
import { PlanningPipeline } from './planning-pipeline';
import {
  assertJobUserActive,
  errorName,
  failureErrorCode,
  resolvePlanningPrompt,
  safeFailureMessage,
} from './planning-prompt';
import type {
  AppendResultChunkData,
  PlanningJobRepository,
} from '../../domain/context/planning-job.repository';

/** Fixed message recorded when the context engine reports a failure. */
export const CONTEXT_ENGINE_FAILED_MESSAGE = 'Context gather failed';
export const DEFAULT_CONTEXT_ENGINE_ERROR_CODE = 'CONTEXT_ENGINE_FAILED';
/**
 * Failure codes accepted from a `failed` chunk. `docs/contracts/` only names
 * `CONTEXT_ENGINE_TIMEOUT` (also used by the no-result timeout) and leaves
 * `error_code` free-form, so anything else becomes the default code.
 */
export const CONTEXT_ENGINE_ERROR_CODES: readonly string[] = [
  DEFAULT_CONTEXT_ENGINE_ERROR_CODE,
  'CONTEXT_ENGINE_TIMEOUT',
];

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
  /** `true` only when this call itself finalized the job (won the
   * `claimForPlanning`/`failIfStillGathering` CAS on a newly-applied
   * terminal `completed`/`failed` status chunk) — `false` for a CAS loser
   * (a concurrent finalize already won). The caller (`ContextResultsConsumer`,
   * which owns all `EventEmitter2` relaying, mirroring `PlanningProcessor`)
   * uses this both to decide which WebSocket events to emit AND — combined
   * with `job.status === Failed` — as the exactly-once signal for reporting
   * the failure to Sentry (this use-case stays framework-pure: no Sentry
   * import here, that lives in the infra-layer consumer). */
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
  private readonly logger = new Logger(HandleContextResultChunkUseCase.name);

  constructor(
    @Inject(PLANNING_JOB_REPOSITORY)
    private readonly planningJobRepository: PlanningJobRepository,
    private readonly planningPipeline: PlanningPipeline,
    @Inject(PROMPT_REPOSITORY)
    private readonly promptRepository: PromptRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
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
    const assembled = this.assembleContext(job.dataChunks);

    // Atomic CAS: gathering -> planning, recording the assembled context.
    // `null` means this call lost the race — some other winner already
    // claimed the job (see the race-safety note in `execute` above).
    // Retrieval only runs for the winner, after the claim.
    const claimed = await this.planningJobRepository.claimForPlanning(
      job.id,
      assembled,
    );
    if (!claimed) {
      return null;
    }

    const resolvedPrompt = await resolvePlanningPrompt(this.promptRepository);
    const promptVersion = resolvedPrompt.promptVersion;

    // Connector chunks plus the retrieved-source metadata; recorded on the
    // job whether planning then succeeds or fails.
    let contextUsed: Record<string, unknown> = assembled;
    let result: ValidatedPlanningResult;
    try {
      // Before retrieval or any provider call: the user may have been
      // disabled or deleted while the job was gathering.
      await assertJobUserActive(this.userRepository, claimed.userId);
      const prepared = await this.planningPipeline.prepare(claimed, assembled);
      contextUsed = prepared.contextUsed;
      // The user may have withdrawn consent during retrieval: check again
      // right before the provider call.
      await assertJobUserActive(this.userRepository, claimed.userId);
      result = await this.planningPipeline.plan(
        resolvedPrompt,
        claimed,
        prepared,
      );
    } catch (err) {
      // Clients read the message: only typed (fixed) messages pass through,
      // and only the error name is logged.
      this.logger.error(
        `Planning job ${claimed.id} failed (${errorName(err)})`,
      );
      const errorMessage = safeFailureMessage(err);
      const errorCode = failureErrorCode(err);
      const failed = await this.planningJobRepository.updateStatus(claimed.id, {
        status: JobStatus.Failed,
        errorCode,
        errorMessage,
        finishedAt: new Date(),
        promptVersion,
        contextUsed,
      });
      return (
        failed ?? {
          ...claimed,
          status: JobStatus.Failed,
          errorCode,
          errorMessage,
          promptVersion,
          contextUsed,
        }
      );
    }

    const { model, ...resultFields } = result;
    const resultDoc: Record<string, unknown> = { ...resultFields };
    const completed = await this.planningJobRepository.updateStatus(
      claimed.id,
      {
        status: JobStatus.Completed,
        result: resultDoc,
        finishedAt: new Date(),
        promptVersion,
        model,
        contextUsed,
      },
    );
    return (
      completed ?? {
        ...claimed,
        status: JobStatus.Completed,
        result: resultDoc,
        promptVersion,
        model,
        contextUsed,
      }
    );
  }

  private finalizeFailed(
    job: PlanningJob,
    status: { errorCode?: string; message?: string },
  ): Promise<PlanningJob | null> {
    // The context engine's own text is never stored, relayed or reported:
    // clients read it. Only an allowlisted code survives; the rest is generic.
    const errorCode =
      status.errorCode !== undefined &&
      CONTEXT_ENGINE_ERROR_CODES.includes(status.errorCode)
        ? status.errorCode
        : DEFAULT_CONTEXT_ENGINE_ERROR_CODE;
    this.logger.warn(`Planning job ${job.id} gather failed (${errorCode})`);
    // Atomic CAS (same guard as `claimForPlanning`, failure side) — `null`
    // means this call lost the race.
    return this.planningJobRepository.failIfStillGathering(job.id, {
      errorCode,
      errorMessage: CONTEXT_ENGINE_FAILED_MESSAGE,
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
