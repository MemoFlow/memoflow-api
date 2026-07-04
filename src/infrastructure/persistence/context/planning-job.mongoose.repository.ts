import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, Model } from 'mongoose';
import { JobStatus, PlanningJob } from '../../../domain/context/planning-job';
import {
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
      result: doc.result,
      errorCode: doc.error_code,
      errorMessage: doc.error_message,
      createdAt: doc.created_at,
      startedAt: doc.started_at,
      finishedAt: doc.finished_at,
    });
  }
}
