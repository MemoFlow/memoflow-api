import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PlanningJob } from '../../../domain/context/planning-job';
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
    const found = await this.model.findById(id).exec();
    return found ? this.toDomain(found) : null;
  }

  async updateStatus(
    id: string,
    patch: UpdatePlanningJobStatusData,
  ): Promise<PlanningJob | null> {
    const update: Record<string, unknown> = { status: patch.status };
    if (patch.result !== undefined) update.result = patch.result;
    if (patch.errorCode !== undefined) update.error_code = patch.errorCode;
    if (patch.errorMessage !== undefined)
      update.error_message = patch.errorMessage;
    if (patch.startedAt !== undefined) update.started_at = patch.startedAt;
    if (patch.finishedAt !== undefined) update.finished_at = patch.finishedAt;

    const updated = await this.model
      .findByIdAndUpdate(id, update, { new: true })
      .exec();
    return updated ? this.toDomain(updated) : null;
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
