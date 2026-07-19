import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Section } from '../../../domain/documents/section.entity';
import {
  CreateSectionData,
  ReplaceSectionData,
  SectionRepository,
  UpdateSectionData,
} from '../../../domain/documents/section.repository';
import { DocumentOrmEntity } from './document.orm-entity';
import { SectionOrmEntity } from './section.orm-entity';

@Injectable()
export class SectionTypeOrmRepository implements SectionRepository {
  constructor(
    @InjectRepository(SectionOrmEntity)
    private readonly repository: Repository<SectionOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(data: CreateSectionData): Promise<Section> {
    const entity = this.repository.create({
      documentId: data.documentId,
      title: data.title,
      content: data.content,
      order: data.order,
      status: data.status,
      wordCount: data.wordCount,
    });
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<Section | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByDocument(documentId: string): Promise<Section[]> {
    // Secondary sort on `createdAt` keeps the ordering deterministic when
    // two rows share the same `order` (e.g. legacy data), instead of
    // falling back to whatever order the DB happens to return them in.
    const entities = await this.repository.find({
      where: { documentId },
      order: { order: 'ASC', createdAt: 'ASC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async update(id: string, patch: UpdateSectionData): Promise<Section> {
    await this.repository.update({ id }, patch);
    const updated = await this.findById(id);
    if (!updated) {
      throw new NotFoundException(`Section ${id} not found`);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  async maxOrder(documentId: string): Promise<number | null> {
    const result = await this.repository
      .createQueryBuilder('section')
      .select('MAX(section.order)', 'max')
      .where('section.document_id = :documentId', { documentId })
      .getRawOne<{ max: string | null }>();
    return result?.max === null || result?.max === undefined
      ? null
      : Number(result.max);
  }

  async reorder(documentId: string, orderedIds: string[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SectionOrmEntity);
      for (const [index, id] of orderedIds.entries()) {
        await repository.update({ id, documentId }, { order: index });
      }
    });
  }

  async replaceAll(
    documentId: string,
    sections: ReplaceSectionData[],
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const documentRepo = manager.getRepository(DocumentOrmEntity);
      const sectionRepo = manager.getRepository(SectionOrmEntity);

      // Lock the parent document row for the duration of the transaction.
      // This only serializes `replaceAll`/`applyToDocument` callers against
      // each other (both take this same lock) — it does NOT serialize
      // against `create`/`update`/`delete`/`reorder` above, none of which
      // take a document-row lock. A concurrent plain section create can
      // still commit mid-restore and survive the DELETE below. Closing that
      // gap (locking every section-write path against the parent document
      // row) is a tracked follow-up shared with templates'
      // `DocumentTemplateTypeOrmRepository.applyToDocument`, not fixed here.
      await documentRepo
        .createQueryBuilder('document')
        .setLock('pessimistic_write')
        .where('document.id = :documentId', { documentId })
        .getOne();

      await sectionRepo.delete({ documentId });

      if (!sections.length) {
        return 0;
      }

      const entities = sections.map((section) =>
        sectionRepo.create({
          documentId,
          title: section.title,
          content: section.content,
          order: section.order,
          status: section.status,
          wordCount: section.wordCount,
        }),
      );
      await sectionRepo.save(entities);
      return entities.length;
    });
  }

  private toDomain(entity: SectionOrmEntity): Section {
    return new Section({
      id: entity.id,
      documentId: entity.documentId,
      title: entity.title,
      content: entity.content,
      order: entity.order,
      status: entity.status,
      wordCount: entity.wordCount,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}
