import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Template } from '../../../domain/templates/template.entity';
import { TemplateSection } from '../../../domain/templates/template-section.entity';
import {
  CreateTemplateData,
  TemplateFilters,
  TemplateRepository,
  UpdateTemplateData,
} from '../../../domain/templates/template.repository';
import { TemplateSectionOrmEntity } from './template-section.orm-entity';
import { TemplateOrmEntity } from './template.orm-entity';

@Injectable()
export class TemplateTypeOrmRepository implements TemplateRepository {
  constructor(
    @InjectRepository(TemplateOrmEntity)
    private readonly repository: Repository<TemplateOrmEntity>,
    @InjectRepository(TemplateSectionOrmEntity)
    private readonly sectionRepository: Repository<TemplateSectionOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(data: CreateTemplateData): Promise<Template> {
    return this.dataSource.transaction(async (manager) => {
      const templateRepo = manager.getRepository(TemplateOrmEntity);
      const sectionRepo = manager.getRepository(TemplateSectionOrmEntity);

      const templateEntity = templateRepo.create({
        title: data.title,
        docType: data.docType,
        scope: data.scope,
        createdBy: data.createdBy,
        styleConfig: data.styleConfig,
        isPublished: data.isPublished,
      });
      const savedTemplate = await templateRepo.save(templateEntity);

      const savedSections = data.sections.length
        ? await sectionRepo.save(
            data.sections.map((section) =>
              sectionRepo.create({ ...section, templateId: savedTemplate.id }),
            ),
          )
        : [];

      return this.toDomain(savedTemplate, savedSections);
    });
  }

  async findById(id: string): Promise<Template | null> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      return null;
    }
    const sections = await this.sectionRepository.find({
      where: { templateId: id },
      order: { order: 'ASC' },
    });
    return this.toDomain(entity, sections);
  }

  async findVisible(
    userId: string,
    filters: TemplateFilters,
  ): Promise<Template[]> {
    const qb = this.repository
      .createQueryBuilder('template')
      .where(
        '(template.is_published = true OR template.created_by = :userId)',
        { userId },
      );

    if (filters.docType) {
      qb.andWhere('template.doc_type = :docType', {
        docType: filters.docType,
      });
    }
    if (filters.scope) {
      qb.andWhere('template.scope = :scope', { scope: filters.scope });
    }

    const entities = await qb.getMany();
    if (!entities.length) {
      return [];
    }

    const sections = await this.sectionRepository.find({
      where: { templateId: In(entities.map((entity) => entity.id)) },
      order: { order: 'ASC' },
    });
    const sectionsByTemplate = new Map<string, TemplateSectionOrmEntity[]>();
    for (const section of sections) {
      const list = sectionsByTemplate.get(section.templateId) ?? [];
      list.push(section);
      sectionsByTemplate.set(section.templateId, list);
    }

    return entities.map((entity) =>
      this.toDomain(entity, sectionsByTemplate.get(entity.id) ?? []),
    );
  }

  async update(id: string, patch: UpdateTemplateData): Promise<Template> {
    return this.dataSource.transaction(async (manager) => {
      const templateRepo = manager.getRepository(TemplateOrmEntity);
      const sectionRepo = manager.getRepository(TemplateSectionOrmEntity);

      const { sections, ...rest } = patch;
      const entity = await templateRepo.preload({ id, ...rest });
      if (!entity) {
        throw new NotFoundException(`Template ${id} not found`);
      }
      const savedTemplate = await templateRepo.save(entity);

      let savedSections: TemplateSectionOrmEntity[];
      if (sections) {
        // Wholesale replace: delete-and-reinsert inside the same
        // transaction as the template row update.
        await sectionRepo.delete({ templateId: id });
        savedSections = sections.length
          ? await sectionRepo.save(
              sections.map((section) =>
                sectionRepo.create({ ...section, templateId: id }),
              ),
            )
          : [];
      } else {
        savedSections = await sectionRepo.find({
          where: { templateId: id },
          order: { order: 'ASC' },
        });
      }

      return this.toDomain(savedTemplate, savedSections);
    });
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  private toDomain(
    entity: TemplateOrmEntity,
    sections: TemplateSectionOrmEntity[],
  ): Template {
    return new Template({
      id: entity.id,
      title: entity.title,
      docType: entity.docType,
      scope: entity.scope,
      createdBy: entity.createdBy,
      styleConfig: entity.styleConfig,
      isPublished: entity.isPublished,
      sections: [...sections]
        .sort((a, b) => a.order - b.order)
        .map(
          (section) =>
            new TemplateSection({
              id: section.id,
              templateId: section.templateId,
              title: section.title,
              order: section.order,
              wordCountMin: section.wordCountMin,
              wordCountMax: section.wordCountMax,
              isRequired: section.isRequired,
            }),
        ),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}
