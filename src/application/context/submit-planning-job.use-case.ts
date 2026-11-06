import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AI_QUOTA } from '../../domain/ai/ai-quota.port';
import type { AiQuota } from '../../domain/ai/ai-quota.port';
import { LLM_GATEWAY } from '../../domain/ai/llm-gateway.port';
import type { LlmGateway } from '../../domain/ai/llm-gateway.port';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import { PLANNING_JOB_REPOSITORY } from '../../domain/context/planning-job.repository';
import type { PlanningJobRepository } from '../../domain/context/planning-job.repository';
import { PROMPT_QUEUE } from '../../domain/context/prompt-queue';
import type { PromptQueue } from '../../domain/context/prompt-queue';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { quotaHttpException } from '../ai/ai-quota-http';

/** One message for every rejected connector, so a client can't tell another
 * user's connection from one that doesn't exist. */
export const INVALID_CONNECTORS_MESSAGE =
  'Connectors must be among your active connections';

export interface SubmitPlanningJobInput {
  userId: string;
  prompt: string;
  connectors?: string[];
  documentId?: string;
  sectionId?: string;
}

/**
 * Creates the `planning_jobs` row (pending) and dispatches it to the queue.
 * `userId` comes from the JWT-authenticated request — `JwtStrategy` already
 * loads the PG `User` via `GetUserByIdUseCase` on every request, so that
 * cross-DB reference is validated upstream. `documentId`/`sectionId` are
 * optional cross-DB references this use-case DOES validate itself before
 * writing to Mongo: a document must be owned by the caller, and a section
 * must belong to that document — both 404 uniformly on violation (see
 * `application/ai/section-access.ts` for the same convention in the ai
 * feature). Depends on documents' domain repository interfaces directly,
 * not its use-cases.
 */
@Injectable()
export class SubmitPlanningJobUseCase {
  private readonly logger = new Logger(SubmitPlanningJobUseCase.name);

  constructor(
    @Inject(PLANNING_JOB_REPOSITORY)
    private readonly planningJobRepository: PlanningJobRepository,
    @Inject(PROMPT_QUEUE)
    private readonly promptQueue: PromptQueue,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository: ConnectorConnectionRepository,
    @Inject(LLM_GATEWAY)
    private readonly llmGateway: LlmGateway,
    @Inject(AI_QUOTA)
    private readonly aiQuota: AiQuota,
  ) {}

  async execute(input: SubmitPlanningJobInput): Promise<PlanningJob> {
    const { documentId, sectionId } =
      await this.resolveAndValidateBinding(input);
    await this.assertConnectorsActive(input.userId, input.connectors ?? []);

    // With a real provider the worker spends quota, so a user who is already
    // over a cap hears it now instead of from a failed job. Nothing is
    // counted here. The stub planner makes no provider call and costs nothing.
    if (this.llmGateway.isAvailable()) {
      try {
        await this.aiQuota.check(input.userId);
      } catch (err) {
        throw quotaHttpException(err) ?? err;
      }
    }

    const created = await this.planningJobRepository.create({
      userId: input.userId,
      prompt: input.prompt,
      connectors: input.connectors ?? [],
      documentId,
      sectionId,
    });

    try {
      await this.promptQueue.enqueue({
        jobId: created.id,
        userId: created.userId,
      });
    } catch (err) {
      // Clients read the stored message and a queue error can carry an
      // internal address: store a fixed one and log only the error name.
      const errorMessage = 'Failed to enqueue job';
      this.logger.error(
        `Failed to enqueue planning job ${created.id} (${
          err instanceof Error ? err.name : 'unknown'
        })`,
      );
      // No orphaned `pending` job — mark it failed so it never looks like
      // it's silently in flight, then surface 503 to the caller. Guarded in
      // its own try/catch so a second Mongo hiccup here can't mask the 503
      // behind an unrelated 500.
      try {
        await this.planningJobRepository.updateStatus(created.id, {
          status: JobStatus.Failed,
          errorCode: 'ENQUEUE_FAILED',
          errorMessage,
          finishedAt: new Date(),
        });
      } catch (updateErr) {
        this.logger.error(
          `Failed to mark planning job ${created.id} as failed after enqueue failure (${
            updateErr instanceof Error ? updateErr.name : 'unknown'
          })`,
        );
      }
      throw new ServiceUnavailableException(
        'Failed to submit planning job for processing',
      );
    }

    return created;
  }

  /**
   * `connectors` holds provider names (`trello`, `notion`, ...): the context
   * engine paths match them against the `provider` of the user's active
   * connections (`resolveActiveConnectorReferences`). Each one must be among
   * them, else 400 with one fixed message. Provider names are public, so this
   * reveals nothing about anyone's connections.
   */
  private async assertConnectorsActive(
    userId: string,
    connectors: string[],
  ): Promise<void> {
    if (connectors.length === 0) return;
    const active =
      await this.connectorConnectionRepository.findActiveByUser(userId);
    const providers = new Set<string>(active.map((c) => c.provider));
    if (!connectors.every((connector) => providers.has(connector))) {
      throw new BadRequestException(INVALID_CONNECTORS_MESSAGE);
    }
  }

  /**
   * Validates the optional `documentId`/`sectionId` binding:
   * - a given `documentId` must be owned by `input.userId`;
   * - a given `sectionId` must exist and belong to `documentId` (when both
   *   are given), or — when only `sectionId` is given — its own document
   *   must be owned by `input.userId` (the resolved `documentId`).
   * A mismatch, a missing row, or an ownership violation all 404
   * identically, never leaking existence.
   */
  private async resolveAndValidateBinding(
    input: SubmitPlanningJobInput,
  ): Promise<{ documentId: string | null; sectionId: string | null }> {
    let documentId = input.documentId ?? null;
    const sectionId = input.sectionId ?? null;

    if (sectionId) {
      const section = await this.sectionRepository.findById(sectionId);
      if (!section) {
        throw new NotFoundException(`Section ${sectionId} not found`);
      }
      if (documentId && section.documentId !== documentId) {
        throw new NotFoundException(`Section ${sectionId} not found`);
      }
      documentId = section.documentId;
    }

    if (documentId) {
      const document = await this.documentRepository.findById(documentId);
      if (!document || document.userId !== input.userId) {
        throw new NotFoundException(`Document ${documentId} not found`);
      }
    }

    return { documentId, sectionId };
  }
}
