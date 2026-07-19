import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { JobStatus } from '../../../domain/context/planning-job';

/**
 * Mongoose ODM entity for the `planning_jobs` collection (see
 * docs/database-schema.md). Field names stay snake_case in Mongo to match
 * the schema doc; the repository's `toDomain` mapper converts to the
 * camelCase domain `PlanningJob`.
 *
 * `prompt_version`/`context_used` arrive with roadmap item 5 (AI layer);
 * `document_id`/`section_id` are now bound at submission time (also item 5).
 */
@Schema({ collection: 'planning_jobs' })
export class PlanningJobOdmEntity {
  @Prop({ type: String, required: true, index: true })
  user_id: string;

  @Prop({ type: String, default: null, index: true })
  document_id: string | null;

  @Prop({ type: String, default: null })
  section_id: string | null;

  @Prop({
    type: String,
    enum: JobStatus,
    required: true,
    default: JobStatus.Pending,
    index: true,
  })
  status: JobStatus;

  @Prop({ type: String, required: true })
  prompt: string;

  @Prop({ type: [String], default: [] })
  connectors: string[];

  // Roadmap item 5 (AI layer) — recorded by the worker (ProcessPlanningJobUseCase)
  // from the active 'planning' prompt; null until the job runs.
  @Prop({ type: String, default: null })
  prompt_version: string | null;

  // Roadmap item 5 (AI layer) — the context-gatherer result used for this
  // run; null until the job runs. Flexible shape (varies by connector).
  @Prop({ type: Object, default: null })
  context_used: Record<string, unknown> | null;

  @Prop({ type: Object, default: null })
  result: Record<string, unknown> | null;

  @Prop({ type: String, default: null })
  error_code: string | null;

  @Prop({ type: String, default: null })
  error_message: string | null;

  @Prop({ type: Date, required: true, default: () => new Date() })
  created_at: Date;

  @Prop({ type: Date, default: null })
  started_at: Date | null;

  @Prop({ type: Date, default: null })
  finished_at: Date | null;
}

export type PlanningJobDocument = HydratedDocument<PlanningJobOdmEntity>;

export const PlanningJobSchema =
  SchemaFactory.createForClass(PlanningJobOdmEntity);
