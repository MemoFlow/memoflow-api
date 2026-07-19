import { Inject, Injectable } from '@nestjs/common';
import { PlanningJob } from '../../domain/context/planning-job';
import { PLANNING_JOB_REPOSITORY } from '../../domain/context/planning-job.repository';
import type { PlanningJobRepository } from '../../domain/context/planning-job.repository';

export interface HandleGatherTimeoutInput {
  jobId: string;
}

export interface HandleGatherTimeoutResult {
  /** True only when this call itself failed the job — the caller
   * (`GatherTimeoutProcessor`) uses this to decide whether to emit
   * `planning.failed`. */
  timedOut: boolean;
  job: PlanningJob | null;
}

const ERROR_CODE = 'CONTEXT_ENGINE_TIMEOUT';
const ERROR_MESSAGE =
  'No terminal context-gather result was received within the configured timeout';

/**
 * Fires when a scheduled BullMQ delayed job (`GatherTimeoutScheduler`)
 * reaches its delay — the durable "no-result timeout" from
 * `docs/contracts/context-engine.md` §4.
 *
 * Race-safety is enforced entirely by the repository's atomic
 * `failIfStillGathering` CAS (`gathering -> failed`, guarded on
 * `status === gathering`) — NOT by a read-then-write here. A timeout firing
 * concurrently with a terminal `ctx.gather.results` chunk (handled by
 * `HandleContextResultChunkUseCase`) can only ever have one winner: whichever
 * CAS lands first. The loser's `failIfStillGathering` call returns `null`
 * and this is a safe no-op — it must never overwrite a job that already
 * reached `planning`/`completed`/`failed` by a real result.
 */
@Injectable()
export class HandleGatherTimeoutUseCase {
  constructor(
    @Inject(PLANNING_JOB_REPOSITORY)
    private readonly planningJobRepository: PlanningJobRepository,
  ) {}

  async execute(
    input: HandleGatherTimeoutInput,
  ): Promise<HandleGatherTimeoutResult> {
    const failed = await this.planningJobRepository.failIfStillGathering(
      input.jobId,
      { errorCode: ERROR_CODE, errorMessage: ERROR_MESSAGE },
    );
    if (failed) {
      return { timedOut: true, job: failed };
    }

    // Lost the CAS (already moved past `gathering` — a real result won the
    // race) or the job doesn't exist. This read is purely informational
    // (logging / the caller's no-op path) — it is NOT used to decide
    // whether to write, so it can't reintroduce the race it's replacing.
    const current = await this.planningJobRepository.findById(input.jobId);
    return { timedOut: false, job: current };
  }
}
