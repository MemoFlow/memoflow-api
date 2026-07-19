import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GetVersionUseCase } from './application/document-versions/get-version.use-case';
import { ListVersionsUseCase } from './application/document-versions/list-versions.use-case';
import { RestoreVersionUseCase } from './application/document-versions/restore-version.use-case';
import { SaveVersionUseCase } from './application/document-versions/save-version.use-case';
import { DOCUMENT_VERSION_REPOSITORY } from './domain/document-versions/document-version.repository';
import { DocumentsModule } from './documents.module';
import { DocumentVersionMongooseRepository } from './infrastructure/persistence/document-versions/document-version.mongoose.repository';
import {
  DocumentVersionOdmEntity,
  DocumentVersionSchema,
} from './infrastructure/persistence/document-versions/document-version.schema';
import { DocumentVersionsController } from './presentation/document-versions/document-versions.controller';

/**
 * Roadmap item 4 — versioning (Mongo `document_versions`). Imports
 * `DocumentsModule` to reuse `DOCUMENT_REPOSITORY`/`SECTION_REPOSITORY`
 * (exported there): `SaveVersionUseCase`/`ListVersionsUseCase`/
 * `GetVersionUseCase` validate PG document ownership before touching Mongo;
 * `RestoreVersionUseCase` replaces a document's sections atomically via
 * `SectionRepository.replaceAll` (added alongside this module).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DocumentVersionOdmEntity.name, schema: DocumentVersionSchema },
    ]),
    DocumentsModule,
  ],
  controllers: [DocumentVersionsController],
  providers: [
    {
      provide: DOCUMENT_VERSION_REPOSITORY,
      useClass: DocumentVersionMongooseRepository,
    },
    SaveVersionUseCase,
    ListVersionsUseCase,
    GetVersionUseCase,
    RestoreVersionUseCase,
  ],
  exports: [DOCUMENT_VERSION_REPOSITORY],
})
export class DocumentVersionsModule {}
