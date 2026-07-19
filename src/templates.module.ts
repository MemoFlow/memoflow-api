import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplyTemplateUseCase } from './application/templates/apply-template.use-case';
import { CreateTemplateUseCase } from './application/templates/create-template.use-case';
import { DeleteTemplateUseCase } from './application/templates/delete-template.use-case';
import { GetTemplateUseCase } from './application/templates/get-template.use-case';
import { ListTemplatesUseCase } from './application/templates/list-templates.use-case';
import { UpdateTemplateUseCase } from './application/templates/update-template.use-case';
import { DOCUMENT_TEMPLATE_REPOSITORY } from './domain/templates/document-template.repository';
import { TEMPLATE_REPOSITORY } from './domain/templates/template.repository';
import { DocumentsModule } from './documents.module';
import { DocumentTemplateOrmEntity } from './infrastructure/persistence/templates/document-template.orm-entity';
import { DocumentTemplateTypeOrmRepository } from './infrastructure/persistence/templates/document-template.typeorm.repository';
import { TemplateSectionOrmEntity } from './infrastructure/persistence/templates/template-section.orm-entity';
import { TemplateTypeOrmRepository } from './infrastructure/persistence/templates/template.typeorm.repository';
import { TemplateOrmEntity } from './infrastructure/persistence/templates/template.orm-entity';
import { TemplatesController } from './presentation/templates/templates.controller';
import { UsersModule } from './users.module';

/**
 * Roadmap item 3 — templates (PG). Imports `DocumentsModule` to reuse
 * `DOCUMENT_REPOSITORY` (exported there) in `ApplyTemplateUseCase` to
 * validate document ownership. The actual section + `document_templates`
 * writes happen atomically in `DocumentTemplateTypeOrmRepository`, which
 * reaches into the documents feature's `DocumentOrmEntity`/`SectionOrmEntity`
 * directly via the shared `DataSource` (not `DocumentsModule`-scoped
 * providers) so both writes share one transaction.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TemplateOrmEntity,
      TemplateSectionOrmEntity,
      DocumentTemplateOrmEntity,
    ]),
    UsersModule,
    DocumentsModule,
  ],
  controllers: [TemplatesController],
  providers: [
    { provide: TEMPLATE_REPOSITORY, useClass: TemplateTypeOrmRepository },
    {
      provide: DOCUMENT_TEMPLATE_REPOSITORY,
      useClass: DocumentTemplateTypeOrmRepository,
    },
    CreateTemplateUseCase,
    ListTemplatesUseCase,
    GetTemplateUseCase,
    UpdateTemplateUseCase,
    DeleteTemplateUseCase,
    ApplyTemplateUseCase,
  ],
  exports: [TEMPLATE_REPOSITORY, DOCUMENT_TEMPLATE_REPOSITORY],
})
export class TemplatesModule {}
