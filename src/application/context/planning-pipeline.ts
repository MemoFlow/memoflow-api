import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PromptTexts } from '../../domain/ai/prompt-definitions';
import { LLM_PLANNER } from '../../domain/context/llm-planner.port';
import type { LlmPlanner } from '../../domain/context/llm-planner.port';
import {
  DEFAULT_SECTION_RETRIEVAL_LIMIT,
  SECTION_RETRIEVER,
} from '../../domain/context/section-retriever.port';
import type {
  RetrievedSection,
  SectionRetriever,
} from '../../domain/context/section-retriever.port';
import {
  AI_MAX_INPUT_CHARS,
  DEFAULT_AI_MAX_INPUT_CHARS,
} from '../ai/max-input-chars.token';
import { validateCitations } from './planning-citations';
import type { ValidatedPlanningResult } from './planning-citations';
import { errorName, planWithGuards } from './planning-prompt';
import {
  budgetSources,
  connectorCandidates,
  orderCandidates,
  sectionCandidates,
} from './planning-sources';
import type { PlanningSourceMeta } from './planning-sources';

/** The job fields the pipeline reads. `userId` scopes retrieval. */
export interface PlanningPipelineJob {
  userId: string;
  documentId: string | null;
  sectionId: string | null;
  prompt: string;
}

/** Stored under `context_used.retrieval`: metadata only, never text. */
export interface RetrievalSummary {
  sources: PlanningSourceMeta[];
  /** Retrieved sections that matched the prompt's terms. */
  matched: number;
  /** Sources that reached the prompt (sections and connectors). */
  used: number;
  /** Candidates left out because the input budget ran out. */
  dropped: number;
  /** Used sources whose excerpt was cut. */
  truncated: number;
  /** True when retrieval itself errored; the job continued without it. */
  failed: boolean;
}

export interface PreparedPlanningContext {
  /** What the job records as `context_used`: connector keys + `retrieval`. */
  contextUsed: Record<string, unknown>;
  /** Connector context exactly as gathered. */
  connectorContext: Record<string, unknown>;
  /** Rendered `[S1] ...` sources, the value of `{{context}}`. */
  renderedContext: string;
  sources: PlanningSourceMeta[];
  /** Raw titles and texts of the used sources, for the leak check only. */
  sourceStrings: string[];
}

/**
 * The one gather-then-plan pipeline behind both transports (the legacy
 * in-process path and the RabbitMQ result handler):
 *
 * 1. retrieve the job owner's own sections (a failure never fails the job);
 * 2. merge connector context, normalised to one source per chunk/provider;
 * 3. apply the input budget, bound-document sections first;
 * 4. render numbered `[S1]` sources, each redacted before it is cut;
 * 5. plan through the guarded call;
 * 6. keep only citations of sources that exist.
 *
 * Split in `prepare` and `plan` so a use-case can record `context_used` even
 * when planning then fails. Retrieved section text is never part of
 * `contextUsed`: only metadata reaches Mongo.
 */
@Injectable()
export class PlanningPipeline {
  private readonly logger = new Logger(PlanningPipeline.name);

  constructor(
    @Inject(LLM_PLANNER) private readonly planner: LlmPlanner,
    @Inject(SECTION_RETRIEVER)
    private readonly retriever: SectionRetriever,
    @Optional()
    @Inject(AI_MAX_INPUT_CHARS)
    private readonly maxInputChars: number = DEFAULT_AI_MAX_INPUT_CHARS,
  ) {}

  /** Steps 1 to 4. Never throws for a retrieval failure. */
  async prepare(
    job: PlanningPipelineJob,
    connectorContext: Record<string, unknown>,
  ): Promise<PreparedPlanningContext> {
    let sections: RetrievedSection[] = [];
    let failed = false;
    try {
      sections = await this.retriever.search({
        userId: job.userId,
        documentId: job.documentId,
        sectionId: job.sectionId,
        query: job.prompt,
        limit: DEFAULT_SECTION_RETRIEVAL_LIMIT,
      });
    } catch (err) {
      failed = true;
      // Name only: a driver error can echo the query or row content.
      this.logger.error(
        `Section retrieval failed for a planning job (${errorName(err)})`,
      );
    }

    const budgeted = budgetSources(
      orderCandidates([
        ...sectionCandidates(sections),
        ...connectorCandidates(connectorContext),
      ]),
      this.maxInputChars,
    );
    const sources: PlanningSourceMeta[] = budgeted.sources.map(
      ({ id, type, title, ref, truncated }) => ({
        id,
        type,
        title,
        ref,
        truncated,
      }),
    );
    const retrieval: RetrievalSummary = {
      sources,
      matched: sections.filter((section) => section.matched).length,
      used: sources.length,
      dropped: budgeted.dropped,
      truncated: sources.filter((source) => source.truncated).length,
      failed,
    };

    return {
      contextUsed: { ...connectorContext, retrieval },
      connectorContext,
      renderedContext: budgeted.text,
      sources,
      sourceStrings: budgeted.sources.flatMap((source) => [
        source.rawTitle,
        source.rawText,
      ]),
    };
  }

  /** Steps 5 and 6. Throws the guard errors `planWithGuards` throws. */
  async plan(
    resolved: PromptTexts,
    job: Pick<PlanningPipelineJob, 'userId' | 'prompt'>,
    prepared: PreparedPlanningContext,
  ): Promise<ValidatedPlanningResult> {
    const result = await planWithGuards(this.planner, resolved, {
      userId: job.userId,
      prompt: job.prompt,
      context: prepared.connectorContext,
      renderedContext: prepared.renderedContext,
      sourceStrings: prepared.sourceStrings,
    });
    return validateCitations(
      result,
      prepared.sources.map(({ id, type, title }) => ({ id, type, title })),
    );
  }
}
