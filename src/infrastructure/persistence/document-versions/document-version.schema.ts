import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Embedded subdocument for one section's full content at save time.
 * `_id: false` — these are plain embedded records, never addressed on
 * their own.
 */
@Schema({ _id: false })
export class SectionSnapshotOdm {
  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  content: string;

  @Prop({ type: Number, required: true })
  order: number;

  @Prop({ type: String, required: true })
  status: string;

  @Prop({ type: Number, required: true, default: 0 })
  word_count: number;
}

export const SectionSnapshotSchema =
  SchemaFactory.createForClass(SectionSnapshotOdm);

/**
 * Mongoose ODM entity for the `document_versions` collection (see
 * docs/database-schema.md). Field names stay snake_case in Mongo to match
 * the schema doc; the repository's `toDomain` mapper converts to the
 * camelCase domain `DocumentVersion`.
 */
@Schema({ collection: 'document_versions' })
export class DocumentVersionOdmEntity {
  @Prop({ type: String, required: true, index: true })
  document_id: string;

  @Prop({ type: String, required: true, index: true })
  user_id: string;

  @Prop({ type: Number, required: true })
  version: number;

  @Prop({ type: String, default: null })
  label: string | null;

  @Prop({ type: [SectionSnapshotSchema], default: [] })
  sections_snapshot: SectionSnapshotOdm[];

  @Prop({ type: Date, required: true, default: () => new Date(), index: true })
  saved_at: Date;
}

export type DocumentVersionDocument =
  HydratedDocument<DocumentVersionOdmEntity>;

export const DocumentVersionSchema = SchemaFactory.createForClass(
  DocumentVersionOdmEntity,
);

// Deliberate addition beyond docs/database-schema.md (not present there —
// docs-maintainer syncs it after this lands): closes the concurrent-save
// race where two saves for the same document both compute the same
// `maxVersion + 1`. The Mongoose repository's `create()` catches the
// resulting E11000 duplicate-key error and retries once with a freshly
// recomputed version before giving up.
DocumentVersionSchema.index({ document_id: 1, version: 1 }, { unique: true });
