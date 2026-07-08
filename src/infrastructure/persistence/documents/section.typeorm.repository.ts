import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Section } from '../../../domain/documents/section.entity';
import {
  CreateSectionData,
  SectionRepository,
  UpdateSectionData,
} from '../../../domain/documents/section.repository';
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
