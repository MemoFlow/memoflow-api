import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DocumentOrmEntity } from '../documents/document.orm-entity';
import { SectionOrmEntity } from '../documents/section.orm-entity';
import { DocumentTemplate } from '../../../domain/templates/document-template.entity';
import {
  ApplyToDocumentData,
  ApplyToDocumentResult,
  DocumentTemplateRepository,
} from '../../../domain/templates/document-template.repository';
import { DocumentTemplateOrmEntity } from './document-template.orm-entity';

@Injectable()
export class DocumentTemplateTypeOrmRepository implements DocumentTemplateRepository {
  constructor(
    @InjectRepository(DocumentTemplateOrmEntity)
    private readonly repository: Repository<DocumentTemplateOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async applyToDocument(
    data: ApplyToDocumentData,
  ): Promise<ApplyToDocumentResult> {
    return this.dataSource.transaction(async (manager) => {
      const documentRepo = manager.getRepository(DocumentOrmEntity);
      const sectionRepo = manager.getRepository(SectionOrmEntity);
      const documentTemplateRepo = manager.getRepository(
        DocumentTemplateOrmEntity,
      );

      // Lock the parent document row for the duration of the transaction so
      // concurrent applications of a template to the same document
      // serialize instead of racing on the `MAX(order)` read below (two
      // concurrent transactions both reading the same max and appending at
      // the same starting order).
      await documentRepo
        .createQueryBuilder('document')
        .setLock('pessimistic_write')
        .where('document.id = :documentId', { documentId: data.documentId })
        .getOne();

      const maxOrderResult = await sectionRepo
        .createQueryBuilder('section')
        .select('MAX(section.order)', 'max')
        .where('section.document_id = :documentId', {
          documentId: data.documentId,
        })
        .getRawOne<{ max: string | null }>();
      const maxOrder =
        maxOrderResult?.max === null || maxOrderResult?.max === undefined
          ? null
          : Number(maxOrderResult.max);

      let nextOrder = (maxOrder ?? -1) + 1;
      const sectionEntities = data.sections.map((section) => {
        const entity = sectionRepo.create({
          documentId: data.documentId,
          title: section.title,
          content: section.content,
          order: nextOrder,
          status: section.status,
          wordCount: section.wordCount,
        });
        nextOrder += 1;
        return entity;
      });
      if (sectionEntities.length) {
        await sectionRepo.save(sectionEntities);
      }

      const documentTemplateEntity = documentTemplateRepo.create({
        documentId: data.documentId,
        templateId: data.templateId,
        appliedAt: data.appliedAt,
        customised: false,
      });
      const savedDocumentTemplate = await documentTemplateRepo.save(
        documentTemplateEntity,
      );

      return {
        documentTemplate: this.toDomain(savedDocumentTemplate),
        sectionsCreated: sectionEntities.length,
      };
    });
  }

  private toDomain(entity: DocumentTemplateOrmEntity): DocumentTemplate {
    return new DocumentTemplate({
      id: entity.id,
      documentId: entity.documentId,
      templateId: entity.templateId,
      appliedAt: entity.appliedAt,
      customised: entity.customised,
    });
  }
}
