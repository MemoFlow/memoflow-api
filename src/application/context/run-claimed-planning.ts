import type { PromptRepository } from '../../domain/ai/prompt.repository';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import type { PlanningJobRepository } from '../../domain/context/planning-job.repository';
import type { UserRepository } from '../../domain/users/user.repository';
import type { ValidatedPlanningResult } from './planning-citations';
import type { PlanningPipeline } from './planning-pipeline';
import {
  assertJobUserActive,
  errorName,
  failureErrorCode,
  resolvePlanningPrompt,
  safeFailureMessage,
} from './planning-prompt';

export interface RunClaimedPlanningDeps {
  planningJobRepository: PlanningJobRepository;
  planningPipeline: PlanningPipeline;
  promptRepository: PromptRepository;
  userRepository: UserRepository;
  logger: { error(message: string): void };
}

/**
 * The planning phase of a job already claimed into `planning`
 * (`claimForPlanning`): resolve the prompt, re-check the user, retrieve,
 * re-check again right before the provider call, plan, validate, and write
 * the terminal `completed`/`failed` state. Shared by the RabbitMQ result
 * handler (connector context from the engine) and by the transport path of
 * `ProcessPlanningJobUseCase` for jobs with nothing to gather. Never throws
 * for a domain failure: it is recorded as `failed`.
 */
export async function runClaimedPlanning(
  deps: RunClaimedPlanningDeps,
  claimed: PlanningJob,
  connectorContext: Record<string, unknown>,
): Promise<PlanningJob> {
  const { planningJobRepository, planningPipeline, logger } = deps;
  // Set inside the `try`, so a failed lookup still ends the job as `failed`
  // instead of leaving it in `planning`.
  let promptVersion: string | null = null;

  // Connector chunks plus the retrieved-source metadata; recorded on the
  // job whether planning then succeeds or fails.
  let contextUsed: Record<string, unknown> = connectorContext;
  let result: ValidatedPlanningResult;
  try {
    const resolvedPrompt = await resolvePlanningPrompt(deps.promptRepository);
    promptVersion = resolvedPrompt.promptVersion;
    // Before retrieval or any provider call: the user may have been
    // disabled or deleted while the job was gathering.
    await assertJobUserActive(deps.userRepository, claimed.userId);
    const prepared = await planningPipeline.prepare(claimed, connectorContext);
    contextUsed = prepared.contextUsed;
    // The user may have withdrawn consent during retrieval: check again
    // right before the provider call.
    await assertJobUserActive(deps.userRepository, claimed.userId);
    result = await planningPipeline.plan(resolvedPrompt, claimed, prepared);
  } catch (err) {
    // Clients read the message: only typed (fixed) messages pass through,
    // and only the error name is logged.
    logger.error(`Planning job ${claimed.id} failed (${errorName(err)})`);
    const errorMessage = safeFailureMessage(err);
    const errorCode = failureErrorCode(err);
    const failed = await planningJobRepository.updateStatus(claimed.id, {
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
  const completed = await planningJobRepository.updateStatus(claimed.id, {
    status: JobStatus.Completed,
    result: resultDoc,
    finishedAt: new Date(),
    promptVersion,
    model,
    contextUsed,
  });
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
