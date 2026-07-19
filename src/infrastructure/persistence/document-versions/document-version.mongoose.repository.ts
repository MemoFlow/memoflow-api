import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, Model } from 'mongoose';
import {
  DocumentVersion,
  DocumentVersionMetadata,
} from '../../../domain/document-versions/document-version.entity';
import {
  CreateDocumentVersionData,
  DocumentVersionRepository,
} from '../../../domain/document-versions/document-version.repository';
import {
  DocumentVersionDocument,
  DocumentVersionOdmEntity,
} from './document-version.schema';

const DUPLICATE_KEY_ERROR_CODE = 11000;

interface DocumentVersionMetadataProjection {
  _id: unknown;
  document_id: string;
  version: number;
  label: string | null;
  saved_at: Date;
  section_count: number;
}

@Injectable()
export class DocumentVersionMongooseRepository implements DocumentVersionRepository {
  constructor(
    @InjectModel(DocumentVersionOdmEntity.name)
    private readonly model: Model<DocumentVersionOdmEntity>,
  ) {}

  async create(data: CreateDocumentVersionData): Promise<DocumentVersion> {
    const created = await this.createWithRetry(data, false);
    return this.toDomain(created);
  }

  /**
   * Computes `version = (maxVersion ?? 0) + 1` and inserts. If a concurrent
   * save for the same document already took that version number, the
   * unique `{ document_id, version }` index rejects the insert with a
   * duplicate-key error (code 11000); this recomputes the max and retries
   * exactly once before letting the error propagate.
   */
  private async createWithRetry(
    data: CreateDocumentVersionData,
    alreadyRetried: boolean,
  ): Promise<DocumentVersionDocument> {
    const currentMax = await this.maxVersion(data.documentId);
    const nextVersion = (currentMax ?? 0) + 1;
    try {
      return await this.model.create({
        document_id: data.documentId,
        user_id: data.userId,
        version: nextVersion,
        label: data.label ?? null,
        sections_snapshot: data.sectionsSnapshot.map((section) => ({
          title: section.title,
          content: section.content,
          order: section.order,
          status: section.status,
          word_count: section.wordCount,
        })),
        saved_at: new Date(),
      });
    } catch (err) {
      if (this.isDuplicateKeyError(err) && !alreadyRetried) {
        return this.createWithRetry(data, true);
      }
      throw err;
    }
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: number }).code === DUPLICATE_KEY_ERROR_CODE
    );
  }

  async findById(id: string): Promise<DocumentVersion | null> {
    const found = await this.runIdQuery(() => this.model.findById(id).exec());
    return found ? this.toDomain(found) : null;
  }

  async findByDocumentId(
    documentId: string,
  ): Promise<DocumentVersionMetadata[]> {
    // Projects `section_count` via `$size` and excludes `sections_snapshot`
    // at the database level — the list endpoint never ships full snapshot
    // payloads.
    const docs = await this.model.aggregate<DocumentVersionMetadataProjection>([
      { $match: { document_id: documentId } },
      { $sort: { saved_at: -1 } },
      {
        $project: {
          document_id: 1,
          version: 1,
          label: 1,
          saved_at: 1,
          section_count: {
            $size: { $ifNull: ['$sections_snapshot', []] },
          },
        },
      },
    ]);

    return docs.map((doc) => ({
      id: String(doc._id),
      documentId: doc.document_id,
      version: doc.version,
      label: doc.label,
      savedAt: doc.saved_at,
      sectionCount: doc.section_count,
    }));
  }

  async maxVersion(documentId: string): Promise<number | null> {
    const top = await this.model
      .findOne({ document_id: documentId })
      .sort({ version: -1 })
      .select('version')
      .exec();
    return top ? top.version : null;
  }

  /**
   * Runs a query keyed on `_id` and translates a Mongoose `CastError` (a
   * non-ObjectId id string) into "not found" instead of letting it
   * propagate as an unhandled 500 — the application layer's null-check
   * already yields the correct 404. The presentation layer's
   * `ParseObjectIdPipe` also 400s malformed ids before they get here; this
   * is defense in depth.
   */
  private async runIdQuery(
    query: () => Promise<DocumentVersionDocument | null>,
  ): Promise<DocumentVersionDocument | null> {
    try {
      return await query();
    } catch (err) {
      if (err instanceof MongooseError.CastError) {
        return null;
      }
      throw err;
    }
  }

  private toDomain(doc: DocumentVersionDocument): DocumentVersion {
    return new DocumentVersion({
      id: doc._id.toString(),
      documentId: doc.document_id,
      userId: doc.user_id,
      version: doc.version,
      label: doc.label,
      sectionsSnapshot: doc.sections_snapshot.map((section) => ({
        title: section.title,
        content: section.content,
        order: section.order,
        status: section.status,
        wordCount: section.word_count,
      })),
      savedAt: doc.saved_at,
    });
  }
}
