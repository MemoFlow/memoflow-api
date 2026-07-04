import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CONTEXT_GATHERER } from '../../domain/context/context-gatherer.port';
import type { ContextGatherer } from '../../domain/context/context-gatherer.port';
import { LLM_PLANNER } from '../../domain/context/llm-planner.port';
import type {
  LlmPlanner,
  PlanningResult,
} from '../../domain/context/llm-planner.port';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import { PLANNING_JOB_REPOSITORY } from '../../domain/context/planning-job.repository';
import type { PlanningJobRepository } from '../../domain/context/planning-job.repository';

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
 * atomically (`pending` -> `running`) at the repository boundary so a
 * BullMQ stalled-job retry and a concurrent worker can never both process
 * the same job.
 */
@Injectable()
export class ProcessPlanningJobUseCase {
  constructor(
    @Inject(PLANNING_JOB_REPOSITORY)
    private readonly planningJobRepository: PlanningJobRepository,
    @Inject(CONTEXT_GATHERER)
    private readonly contextGatherer: ContextGatherer,
    @Inject(LLM_PLANNER)
    private readonly llmPlanner: LlmPlanner,
  ) {}

  async execute(
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

    let result: PlanningResult;
    try {
      const context = await this.contextGatherer.gather({
        userId: claimed.userId,
        connectors: claimed.connectors,
        prompt: claimed.prompt,
      });
      result = await this.llmPlanner.plan({
        prompt: claimed.prompt,
        context,
      });
    } catch (err) {
      // A domain failure (gather/plan) is a terminal state, not a queue
      // retry — write `failed` and return it, do not rethrow.
      const errorMessage =
        err instanceof Error ? err.message : 'Planning job processing failed';
      const failed = await this.planningJobRepository.updateStatus(claimed.id, {
        status: JobStatus.Failed,
        errorCode: 'PROCESSING_FAILED',
        errorMessage,
        finishedAt: new Date(),
      });
      return {
        processed: true,
        job: failed ?? { ...claimed, status: JobStatus.Failed, errorMessage },
      };
    }

    const resultDoc: Record<string, unknown> = { ...result };
    const completed = await this.planningJobRepository.updateStatus(
      claimed.id,
      {
        status: JobStatus.Completed,
        result: resultDoc,
        finishedAt: new Date(),
      },
    );
    return {
      processed: true,
      job: completed ?? {
        ...claimed,
        status: JobStatus.Completed,
        result: resultDoc,
      },
    };
  }
}
