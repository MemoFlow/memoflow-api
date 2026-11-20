import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Document } from '../../../domain/documents/document.entity';
import { LimitReachedError } from '../../../domain/limits/storage-limits';
import {
  CreateDocumentData,
  CreateDocumentOptions,
  DocumentRepository,
  UpdateDocumentData,
} from '../../../domain/documents/document.repository';
import { DocumentOrmEntity } from './document.orm-entity';

@Injectable()
export class DocumentTypeOrmRepository implements DocumentRepository {
  constructor(
    @InjectRepository(DocumentOrmEntity)
    private readonly repository: Repository<DocumentOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    data: CreateDocumentData,
    options: CreateDocumentOptions,
  ): Promise<Document> {
    return this.dataSource.transaction(async (manager) => {
      // Lock the owner's user row so concurrent creates for the same user
      // serialize: count-then-insert below can't both see "one slot left".
      await manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        data.userId,
      ]);
      const repo = manager.getRepository(DocumentOrmEntity);
      const count = await repo.count({ where: { userId: data.userId } });
      if (count >= options.maxPerUser) {
        throw new LimitReachedError('document', options.maxPerUser);
      }
      const saved = await repo.save(
        repo.create({
          userId: data.userId,
          title: data.title,
          docType: data.docType,
          status: data.status,
          styleConfig: data.styleConfig,
        }),
      );
      return this.toDomain(saved);
    });
  }

  async findById(id: string): Promise<Document | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByUser(userId: string): Promise<Document[]> {
    const entities = await this.repository.find({ where: { userId } });
    return entities.map((entity) => this.toDomain(entity));
  }

  async update(id: string, patch: UpdateDocumentData): Promise<Document> {
    // `.update()`'s QueryDeepPartialEntity type treats the jsonb
    // `styleConfig` column as a nested partial object rather than a value to
    // replace wholesale, so patches go through preload+save instead.
    const entity = await this.repository.preload({ id, ...patch });
    if (!entity) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  private toDomain(entity: DocumentOrmEntity): Document {
    return new Document({
      id: entity.id,
      userId: entity.userId,
      title: entity.title,
      docType: entity.docType,
      status: entity.status,
      styleConfig: entity.styleConfig,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}
