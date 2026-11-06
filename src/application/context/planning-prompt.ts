import { randomBytes } from 'node:crypto';
import {
  PROMPT_DEFINITIONS_V3,
  PromptTexts,
} from '../../domain/ai/prompt-definitions';
import {
  collectStrings,
  leaksPrompt,
  prepareUntrustedText,
} from '../../domain/ai/prompt-guards';
import { renderPrompt } from '../../domain/ai/prompt-render';
import type { PromptRepository } from '../../domain/ai/prompt.repository';
import {
  SuggestionGenerationProviderError,
  SuggestionGenerationRefusedError,
  SuggestionGenerationTruncatedError,
  SuggestionGeneratorRateLimitedError,
  SuggestionGeneratorUnavailableError,
} from '../../domain/ai/suggestion-generation.errors';
import type {
  LlmPlanner,
  PlanningResult,
} from '../../domain/context/llm-planner.port';
import {
  PLANNING_FAILED_MESSAGE,
  PlanningOutputInvalidError,
  PlanningOutputRejectedError,
} from '../../domain/context/planning-errors';

/** Feature type of the planning prompt. */
export const PLANNING_FEATURE_TYPE = 'planning';

export interface ResolvedPlanningPrompt extends PromptTexts {
  /** Null when no active prompt exists and the built-in fallback is used. */
  promptVersion: string | null;
}

/**
 * Looks up the active `planning` prompt. A missing prompt is not a job
 * failure: the built-in v3 text is used and `promptVersion` stays null.
 */
export async function resolvePlanningPrompt(
  promptRepository: PromptRepository,
): Promise<ResolvedPlanningPrompt> {
  const active = await promptRepository.findActiveByFeatureType(
    PLANNING_FEATURE_TYPE,
  );
  if (active) {
    return {
      promptVersion: active.version,
      systemTemplate: active.systemTemplate,
      userTemplate: active.template,
    };
  }
  return {
    promptVersion: null,
    ...PROMPT_DEFINITIONS_V3[PLANNING_FEATURE_TYPE],
  };
}

export interface RenderedPlanningPrompt {
  system: string;
  user: string;
  /** The per-call nonce, kept as the leak canary for the reply check. */
  nonce: string;
}

/**
 * Renders both templates with a fresh per-call nonce. The request is
 * untrusted: it is redacted and has fence tags neutralised here. The
 * context arrives already prepared and within budget (`PlanningPipeline`
 * redacts and cuts every source), so it is substituted as is. Throws if a
 * template uses an unknown placeholder, so call it inside the job's try
 * block.
 */
export function renderPlanningPrompt(
  resolved: PromptTexts,
  prompt: string,
  renderedContext: string,
): RenderedPlanningPrompt {
  const nonce = randomBytes(16).toString('hex');
  const vars = {
    prompt: prepareUntrustedText(prompt),
    context: renderedContext,
    nonce,
  };
  return {
    system: renderPrompt(resolved.systemTemplate, vars),
    user: renderPrompt(resolved.userTemplate, vars),
    nonce,
  };
}

/** Free text in a planning result, for the leak check. */
function planningResultStrings(result: PlanningResult): string[] {
  const strings = [...result.suggestions];
  if (typeof result.outline === 'string') strings.push(result.outline);
  for (const source of result.sources) {
    if (typeof source === 'string') strings.push(source);
  }
  return strings;
}

export interface GuardedPlanRequest {
  prompt: string;
  /** Raw connector context, for planners that read it directly (the stub). */
  context: Record<string, unknown>;
  /** Numbered, redacted, budgeted sources: the `{{context}}` value. */
  renderedContext: string;
  /**
   * Raw strings the model legitimately saw (source titles and text), so
   * quoting them back is not mistaken for leaking the system prompt.
   */
  sourceStrings: string[];
}

/**
 * The one place both planning paths render, call the planner and check the
 * reply, so they behave identically. A reply that echoes the nonce or the
 * system prompt throws `PlanningOutputRejectedError`. The result is inert
 * data: it is stored and returned, never executed or fed back to a model.
 */
export async function planWithGuards(
  planner: LlmPlanner,
  resolved: PromptTexts,
  request: GuardedPlanRequest,
): Promise<PlanningResult> {
  const { nonce, ...rendered } = renderPlanningPrompt(
    resolved,
    request.prompt,
    request.renderedContext,
  );
  const result = await planner.plan({
    prompt: request.prompt,
    context: request.context,
    ...rendered,
  });
  const leaked = leaksPrompt(planningResultStrings(result).join('\n'), {
    nonce,
    system: rendered.system,
    source: [
      request.prompt,
      ...collectStrings(request.context),
      ...request.sourceStrings,
    ].join('\n'),
  });
  if (leaked) throw new PlanningOutputRejectedError();
  return result;
}

/**
 * The message to record on a failed job. Typed errors carry fixed messages
 * and pass through; anything else (gather errors, driver errors, ...) may
 * echo content, so it becomes a generic message.
 */
export function safeFailureMessage(err: unknown): string {
  if (
    err instanceof PlanningOutputInvalidError ||
    err instanceof PlanningOutputRejectedError ||
    err instanceof SuggestionGenerationProviderError ||
    err instanceof SuggestionGenerationRefusedError ||
    err instanceof SuggestionGenerationTruncatedError ||
    err instanceof SuggestionGeneratorRateLimitedError ||
    err instanceof SuggestionGeneratorUnavailableError
  ) {
    return err.message;
  }
  return PLANNING_FAILED_MESSAGE;
}

/** Error name only: messages can echo prompts, context or provider text. */
export function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown';
}
