import { randomBytes } from 'node:crypto';
import {
  PROMPT_DEFINITIONS_V2,
  PromptTexts,
} from '../../domain/ai/prompt-definitions';
import { renderPrompt } from '../../domain/ai/prompt-render';
import type { PromptRepository } from '../../domain/ai/prompt.repository';

/** Feature type of the planning prompt. */
export const PLANNING_FEATURE_TYPE = 'planning';

export interface ResolvedPlanningPrompt extends PromptTexts {
  /** Null when no active prompt exists and the built-in fallback is used. */
  promptVersion: string | null;
}

/**
 * Looks up the active `planning` prompt. A missing prompt is not a job
 * failure: the built-in v2 text is used and `promptVersion` stays null.
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
    ...PROMPT_DEFINITIONS_V2[PLANNING_FEATURE_TYPE],
  };
}

/**
 * Renders both templates with a fresh per-call nonce. Throws if a template
 * uses an unknown placeholder, so call it inside the job's try block.
 */
export function renderPlanningPrompt(
  resolved: PromptTexts,
  prompt: string,
  context: Record<string, unknown>,
): { system: string; user: string } {
  const vars = {
    prompt,
    context: JSON.stringify(context),
    nonce: randomBytes(16).toString('hex'),
  };
  return {
    system: renderPrompt(resolved.systemTemplate, vars),
    user: renderPrompt(resolved.userTemplate, vars),
  };
}
