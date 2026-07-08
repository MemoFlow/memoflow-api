import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../../../domain/documents/document.entity';
import {
  CreateDocumentData,
  DocumentRepository,
  UpdateDocumentData,
} from '../../../domain/documents/document.repository';
import { DocumentOrmEntity } from './document.orm-entity';

@Injectable()
export class DocumentTypeOrmRepository implements DocumentRepository {
  constructor(
    @InjectRepository(DocumentOrmEntity)
    private readonly repository: Repository<DocumentOrmEntity>,
  ) {}

  async create(data: CreateDocumentData): Promise<Document> {
    const entity = this.repository.create({
      userId: data.userId,
      title: data.title,
      docType: data.docType,
      status: data.status,
      styleConfig: data.styleConfig,
    });
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
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
