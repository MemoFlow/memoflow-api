import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, Model } from 'mongoose';
import { JobStatus, PlanningJob } from '../../../domain/context/planning-job';
import {
  AppendResultChunkData,
  AppendResultChunkOutcome,
  CreatePlanningJobData,
  PlanningJobRepository,
  UpdatePlanningJobStatusData,
} from '../../../domain/context/planning-job.repository';
import {
  PlanningJobDocument,
  PlanningJobOdmEntity,
} from './planning-job.schema';

@Injectable()
export class PlanningJobMongooseRepository implements PlanningJobRepository {
  constructor(
    @InjectModel(PlanningJobOdmEntity.name)
    private readonly model: Model<PlanningJobOdmEntity>,
  ) {}

  async create(data: CreatePlanningJobData): Promise<PlanningJob> {
    const created = await this.model.create({
      user_id: data.userId,
      document_id: data.documentId ?? null,
      section_id: data.sectionId ?? null,
      prompt: data.prompt,
      connectors: data.connectors,
    });
    return this.toDomain(created);
  }

  async findById(id: string): Promise<PlanningJob | null> {
    const found = await this.runIdQuery(() => this.model.findById(id).exec());
    return found ? this.toDomain(found) : null;
  }

  async updateStatus(
    id: string,
    patch: UpdatePlanningJobStatusData,
  ): Promise<PlanningJob | null> {
    const update = this.toUpdateDoc(patch);
    const updated = await this.runIdQuery(() =>
      this.model.findByIdAndUpdate(id, update, { new: true }).exec(),
    );
    return updated ? this.toDomain(updated) : null;
  }

  async claimForProcessing(id: string): Promise<PlanningJob | null> {
    // Atomic claim: only succeeds if the job is still `pending`, so a
    // BullMQ stalled-job retry and a concurrent worker can't both flip the
    // same job to `running` and reprocess it.
    const claimed = await this.runIdQuery(() =>
      this.model
        .findOneAndUpdate(
          { _id: id, status: JobStatus.Pending },
          { status: JobStatus.Running, started_at: new Date() },
          { new: true },
        )
        .exec(),
    );
    return claimed ? this.toDomain(claimed) : null;
  }

  async claimForGathering(id: string): Promise<PlanningJob | null> {
    // RabbitMQ-transport equivalent of claimForProcessing above — same
    // atomic "only from pending" guard, different target status.
    const claimed = await this.runIdQuery(() =>
      this.model
        .findOneAndUpdate(
          { _id: id, status: JobStatus.Pending },
          { status: JobStatus.Gathering, started_at: new Date() },
          { new: true },
        )
        .exec(),
    );
    return claimed ? this.toDomain(claimed) : null;
  }

  async appendResultChunk(
    id: string,
    chunk: AppendResultChunkData,
  ): Promise<AppendResultChunkOutcome> {
    // Atomic idempotency guard: the update only matches (and therefore only
    // pushes) when `chunk.sequence` isn't already recorded for this job, so
    // a redelivered/duplicate chunk can never be double-applied.
    const push: Record<string, unknown> = { chunk_sequences: chunk.sequence };
    if (chunk.type === 'data' && chunk.data) {
      push.data_chunks = {
        sequence: chunk.sequence,
        provider: chunk.data.provider,
        content: chunk.data.content,
        token_estimate: chunk.data.tokenEstimate ?? null,
      };
    }

    const applied = await this.runIdQuery(() =>
      this.model
        .findOneAndUpdate(
          { _id: id, chunk_sequences: { $ne: chunk.sequence } },
          { $push: push },
          { new: true },
        )
        .exec(),
    );
    if (applied) {
      return { applied: true, job: this.toDomain(applied) };
    }

    // Either the job doesn't exist, or `chunk.sequence` was already
    // recorded (duplicate) — fetch current state so the caller can tell
    // the two apart (unknown job -> nack; duplicate -> ack no-op).
    const existing = await this.runIdQuery(() =>
      this.model.findById(id).exec(),
    );
    return { applied: false, job: existing ? this.toDomain(existing) : null };
  }

  async claimForPlanning(
    id: string,
    contextUsed: Record<string, unknown>,
  ): Promise<PlanningJob | null> {
    // Atomic CAS: only succeeds if the job is still `gathering`, so a
    // concurrent/duplicate terminal chunk (or a no-result timeout racing
    // this same job) can never both finalize it.
    const claimed = await this.runIdQuery(() =>
      this.model
        .findOneAndUpdate(
          { _id: id, status: JobStatus.Gathering },
          { status: JobStatus.Planning, context_used: contextUsed },
          { new: true },
        )
        .exec(),
    );
    return claimed ? this.toDomain(claimed) : null;
  }

  async failIfStillGathering(
    id: string,
    patch: { errorCode: string; errorMessage: string },
  ): Promise<PlanningJob | null> {
    // Same atomic CAS as `claimForPlanning`, covering the failure side —
    // shared by `HandleGatherTimeoutUseCase` and
    // `HandleContextResultChunkUseCase`'s terminal-failed path.
    const failed = await this.runIdQuery(() =>
      this.model
        .findOneAndUpdate(
          { _id: id, status: JobStatus.Gathering },
          {
            status: JobStatus.Failed,
            error_code: patch.errorCode,
            error_message: patch.errorMessage,
            finished_at: new Date(),
          },
          { new: true },
        )
        .exec(),
    );
    return failed ? this.toDomain(failed) : null;
  }

  /**
   * Runs a query keyed on `_id` and translates a Mongoose `CastError` (a
   * non-ObjectId id string, e.g. from `GET /planning-jobs/abc`) into "not
   * found" instead of letting it propagate as an unhandled 500 — the
   * application layer's null-check already yields the correct 404.
   */
  private async runIdQuery(
    query: () => Promise<PlanningJobDocument | null>,
  ): Promise<PlanningJobDocument | null> {
    try {
      return await query();
    } catch (err) {
      if (err instanceof MongooseError.CastError) {
        return null;
      }
      throw err;
    }
  }

  private toUpdateDoc(
    patch: UpdatePlanningJobStatusData,
  ): Record<string, unknown> {
    const update: Record<string, unknown> = { status: patch.status };
    if (patch.result !== undefined) update.result = patch.result;
    if (patch.errorCode !== undefined) update.error_code = patch.errorCode;
    if (patch.errorMessage !== undefined)
      update.error_message = patch.errorMessage;
    if (patch.startedAt !== undefined) update.started_at = patch.startedAt;
    if (patch.finishedAt !== undefined) update.finished_at = patch.finishedAt;
    if (patch.promptVersion !== undefined)
      update.prompt_version = patch.promptVersion;
    if (patch.contextUsed !== undefined)
      update.context_used = patch.contextUsed;
    return update;
  }

  private toDomain(doc: PlanningJobDocument): PlanningJob {
    return new PlanningJob({
      id: doc._id.toString(),
      userId: doc.user_id,
      documentId: doc.document_id,
      sectionId: doc.section_id,
      status: doc.status,
      prompt: doc.prompt,
      connectors: doc.connectors,
      promptVersion: doc.prompt_version ?? null,
      contextUsed: doc.context_used ?? null,
      result: doc.result,
      errorCode: doc.error_code,
      errorMessage: doc.error_message,
      createdAt: doc.created_at,
      startedAt: doc.started_at,
      finishedAt: doc.finished_at,
      dataChunks: (doc.data_chunks ?? []).map((c) => ({
        sequence: c.sequence,
        provider: c.provider,
        content: c.content,
        tokenEstimate: c.token_estimate ?? null,
      })),
    });
  }
}
