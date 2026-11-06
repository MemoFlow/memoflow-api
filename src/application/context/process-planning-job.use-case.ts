import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';
import { PROMPT_REPOSITORY } from '../../domain/ai/prompt.repository';
import type { PromptRepository } from '../../domain/ai/prompt.repository';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { CONTEXT_GATHERER } from '../../domain/context/context-gatherer.port';
import type { ContextGatherer } from '../../domain/context/context-gatherer.port';
import { CONTEXT_REQUEST_PUBLISHER } from '../../domain/context/context-request-publisher.port';
import type { ContextRequestPublisher } from '../../domain/context/context-request-publisher.port';
import { GATHER_TIMEOUT_SCHEDULER } from '../../domain/context/gather-timeout-scheduler.port';
import type { GatherTimeoutScheduler } from '../../domain/context/gather-timeout-scheduler.port';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import { PLANNING_JOB_REPOSITORY } from '../../domain/context/planning-job.repository';
import type { PlanningJobRepository } from '../../domain/context/planning-job.repository';
import { resolveActiveConnectorReferences } from '../../domain/context/resolve-connector-references';
import { GATHER_TIMEOUT_MS } from './gather-timeout-ms.token';
import type { ValidatedPlanningResult } from './planning-citations';
import { PlanningPipeline } from './planning-pipeline';
import {
  assertJobUserActive,
  errorName,
  failureErrorCode,
  resolvePlanningPrompt,
  safeFailureMessage,
} from './planning-prompt';

/** Mirrors `docs/contracts/context-engine.md` §4's default — also the
 * `CONTEXT_GATHER_TIMEOUT_MS` env default in `env.validation.ts`. Used only
 * if `ContextModule`'s `GATHER_TIMEOUT_MS` provider is somehow absent
 * (never happens in practice — it's provided unconditionally — but keeps
 * this use-case safe to construct without it, e.g. in unit tests). */
const DEFAULT_GATHER_TIMEOUT_MS = 120_000;

export interface ProcessPlanningJobInput {
  jobId: string;
}

export interface ProcessPlanningJobResult {
  /** False when this call was a no-op (nothing left to claim/process). */
  processed: boolean;
  job: PlanningJob;
}

/**
 * The job orchestration itself, kept out of the queue adapter so it stays
 * framework-pure (no BullMQ/EventEmitter2 imports here — the processor emits
 * events after this returns). Idempotent and race-safe: claims the job
 * atomically at the repository boundary so a BullMQ stalled-job retry and a
 * concurrent worker can never both process the same job.
 *
 * **Two transports, one branch point** (`docs/contracts/context-engine.md`):
 * when `CONTEXT_REQUEST_PUBLISHER` is bound (`RABBITMQ_URL` configured),
 * this claims `pending -> gathering`, publishes the gather request to
 * RabbitMQ, schedules the no-result timeout, and returns — the terminal
 * transition (`gathering -> planning -> completed/failed`) happens later,
 * asynchronously, via `HandleContextResultChunkUseCase` when the CE's
 * result chunks arrive. When it's absent (the legacy, still-supported
 * path), this claims `pending -> running` and runs the whole
 * gather-then-plan pipeline synchronously in-process, exactly as before —
 * unchanged so existing tests/behavior stay green with `RABBITMQ_URL` unset.
 */
@Injectable()
export class ProcessPlanningJobUseCase {
  private readonly logger = new Logger(ProcessPlanningJobUseCase.name);

  constructor(
    @Inject(PLANNING_JOB_REPOSITORY)
    private readonly planningJobRepository: PlanningJobRepository,
    @Inject(CONTEXT_GATHERER)
    private readonly contextGatherer: ContextGatherer,
    private readonly planningPipeline: PlanningPipeline,
    @Inject(PROMPT_REPOSITORY)
    private readonly promptRepository: PromptRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    @Optional()
    @Inject(CONTEXT_REQUEST_PUBLISHER)
    private readonly contextRequestPublisher?: ContextRequestPublisher,
    @Optional()
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository?: ConnectorConnectionRepository,
    @Optional()
    @Inject(GATHER_TIMEOUT_SCHEDULER)
    private readonly gatherTimeoutScheduler?: GatherTimeoutScheduler,
    @Optional()
    @Inject(GATHER_TIMEOUT_MS)
    private readonly gatherTimeoutMs?: number,
  ) {}

  execute(input: ProcessPlanningJobInput): Promise<ProcessPlanningJobResult> {
    // `contextRequestPublisher` is only bound by `ContextModule` when
    // `RABBITMQ_URL` is configured — its presence IS the transport-mode
    // switch (see the class doc comment for the two branches).
    return this.contextRequestPublisher
      ? this.executeViaTransport(input, this.contextRequestPublisher)
      : this.executeLegacy(input);
  }

  private async executeLegacy(
    input: ProcessPlanningJobInput,
  ): Promise<ProcessPlanningJobResult> {
    const claimed = await this.planningJobRepository.claimForProcessing(
      input.jobId,
    );

    if (!claimed) {
      // Not claimable: missing, already running (another worker), or
      // already terminal. Distinguish only "missing" (404) from the rest,
      // which are all safe no-ops — never re-run gather/plan.
      const existing = await this.planningJobRepository.findById(input.jobId);
      if (!existing) {
        throw new NotFoundException(`Planning job ${input.jobId} not found`);
      }
      return { processed: false, job: existing };
    }

    // Recorded on the job regardless of outcome (see docs/database-schema.md
    // §planning_jobs) — a missing active 'planning' prompt is not itself a
    // processing failure: the built-in text is used and promptVersion stays null.
    const resolvedPrompt = await resolvePlanningPrompt(this.promptRepository);
    const promptVersion = resolvedPrompt.promptVersion;

    let context: Record<string, unknown> | undefined;
    let result: ValidatedPlanningResult;
    try {
      // Before any gathering, retrieval or provider call: the user may have
      // been disabled or deleted while the job waited in the queue.
      await assertJobUserActive(this.userRepository, claimed.userId);
      const gathered = await this.contextGatherer.gather({
        userId: claimed.userId,
        connectors: claimed.connectors,
        prompt: claimed.prompt,
      });
      // Retrieval joins the connector context here; `context` (what is
      // recorded as `context_used`) is set before planning so a failed plan
      // still records it.
      const prepared = await this.planningPipeline.prepare(claimed, gathered);
      context = prepared.contextUsed;
      // The user may have withdrawn consent while gathering or retrieving:
      // check again right before the provider call.
      await assertJobUserActive(this.userRepository, claimed.userId);
      result = await this.planningPipeline.plan(
        resolvedPrompt,
        claimed,
        prepared,
      );
    } catch (err) {
      // A domain failure (gather/plan) is a terminal state, not a queue
      // retry — write `failed` and return it, do not rethrow. `contextUsed`
      // is recorded when gather succeeded but plan subsequently failed.
      // Clients read the message: only typed (fixed) messages pass through,
      // and only the error name is logged.
      this.logger.error(
        `Planning job ${claimed.id} failed (${errorName(err)})`,
      );
      const errorMessage = safeFailureMessage(err);
      const errorCode = failureErrorCode(err);
      const contextUsed = context ?? null;
      const failed = await this.planningJobRepository.updateStatus(claimed.id, {
        status: JobStatus.Failed,
        errorCode,
        errorMessage,
        finishedAt: new Date(),
        promptVersion,
        contextUsed,
      });
      return {
        processed: true,
        job: failed ?? {
          ...claimed,
          status: JobStatus.Failed,
          errorCode,
          errorMessage,
          promptVersion,
          contextUsed,
        },
      };
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
        contextUsed: context,
      },
    );
    return {
      processed: true,
      job: completed ?? {
        ...claimed,
        status: JobStatus.Completed,
        result: resultDoc,
        promptVersion,
        model,
        contextUsed: context ?? null,
      },
    };
  }

  private async executeViaTransport(
    input: ProcessPlanningJobInput,
    contextRequestPublisher: ContextRequestPublisher,
  ): Promise<ProcessPlanningJobResult> {
    const claimed = await this.planningJobRepository.claimForGathering(
      input.jobId,
    );

    if (!claimed) {
      const existing = await this.planningJobRepository.findById(input.jobId);
      if (!existing) {
        throw new NotFoundException(`Planning job ${input.jobId} not found`);
      }
      return { processed: false, job: existing };
    }

    // Before the gather request leaves: a disabled user's job must not reach
    // the context engine. Finalising checks again.
    try {
      await assertJobUserActive(this.userRepository, claimed.userId);
    } catch (err) {
      this.logger.error(
        `Planning job ${claimed.id} not started (${errorName(err)})`,
      );
      const errorCode = failureErrorCode(err);
      const errorMessage = safeFailureMessage(err);
      const failed = await this.planningJobRepository.updateStatus(claimed.id, {
        status: JobStatus.Failed,
        errorCode,
        errorMessage,
        finishedAt: new Date(),
      });
      return {
        processed: true,
        job: failed ?? {
          ...claimed,
          status: JobStatus.Failed,
          errorCode,
          errorMessage,
        },
      };
    }

    const connectors = this.connectorConnectionRepository
      ? await resolveActiveConnectorReferences(
          this.connectorConnectionRepository,
          claimed.userId,
          claimed.connectors,
        )
      : [];

    try {
      await contextRequestPublisher.publishGatherRequest({
        jobId: claimed.id,
        userId: claimed.userId,
        prompt: claimed.prompt,
        connectors,
        requestedAt: new Date(),
      });
    } catch (err) {
      // Can't proceed without the CE ever seeing this job — terminal
      // failure, not a queue retry (mirrors the legacy gather/plan catch).
      this.logger.error(
        `Planning job ${claimed.id} gather publish failed (${errorName(err)})`,
      );
      const errorMessage = 'Failed to publish context gather request';
      const failed = await this.planningJobRepository.updateStatus(claimed.id, {
        status: JobStatus.Failed,
        errorCode: 'CONTEXT_ENGINE_PUBLISH_FAILED',
        errorMessage,
        finishedAt: new Date(),
      });
      return {
        processed: true,
        job: failed ?? {
          ...claimed,
          status: JobStatus.Failed,
          errorCode: 'CONTEXT_ENGINE_PUBLISH_FAILED',
          errorMessage,
        },
      };
    }

    if (this.gatherTimeoutScheduler) {
      await this.gatherTimeoutScheduler.scheduleTimeout({
        jobId: claimed.id,
        delayMs: this.gatherTimeoutMs ?? DEFAULT_GATHER_TIMEOUT_MS,
      });
    }

    // Publish succeeded — the job now waits on `ctx.gather.results`
    // (`HandleContextResultChunkUseCase`) or the timeout, not this call.
    return { processed: true, job: claimed };
  }
}
