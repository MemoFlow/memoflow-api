import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import { PLANNING_JOB_REPOSITORY } from '../../domain/context/planning-job.repository';
import type { PlanningJobRepository } from '../../domain/context/planning-job.repository';
import { PROMPT_QUEUE } from '../../domain/context/prompt-queue';
import type { PromptQueue } from '../../domain/context/prompt-queue';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';

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
  ) {}

  async execute(input: SubmitPlanningJobInput): Promise<PlanningJob> {
    const { documentId, sectionId } =
      await this.resolveAndValidateBinding(input);

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
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to enqueue job';
      this.logger.error(
        `Failed to enqueue planning job ${created.id}: ${errorMessage}`,
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
        const updateErrorMessage =
          updateErr instanceof Error
            ? updateErr.message
            : 'Failed to mark job as failed';
        this.logger.error(
          `Failed to mark planning job ${created.id} as failed after enqueue failure: ${updateErrorMessage}`,
        );
      }
      throw new ServiceUnavailableException(
        'Failed to submit planning job for processing',
      );
    }

    return created;
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
