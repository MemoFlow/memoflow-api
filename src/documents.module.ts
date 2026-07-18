import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreateDocumentUseCase } from './application/documents/create-document.use-case';
import { CreateSectionUseCase } from './application/documents/create-section.use-case';
import { DeleteDocumentUseCase } from './application/documents/delete-document.use-case';
import { DeleteSectionUseCase } from './application/documents/delete-section.use-case';
import { GetDocumentUseCase } from './application/documents/get-document.use-case';
import { GetSectionUseCase } from './application/documents/get-section.use-case';
import { ListDocumentsUseCase } from './application/documents/list-documents.use-case';
import { ListSectionsUseCase } from './application/documents/list-sections.use-case';
import { ReorderSectionsUseCase } from './application/documents/reorder-sections.use-case';
import { UpdateDocumentUseCase } from './application/documents/update-document.use-case';
import { UpdateSectionUseCase } from './application/documents/update-section.use-case';
import { DOCUMENT_REPOSITORY } from './domain/documents/document.repository';
import { SECTION_REPOSITORY } from './domain/documents/section.repository';
import { DocumentOrmEntity } from './infrastructure/persistence/documents/document.orm-entity';
import { DocumentTypeOrmRepository } from './infrastructure/persistence/documents/document.typeorm.repository';
import { SectionOrmEntity } from './infrastructure/persistence/documents/section.orm-entity';
import { SectionTypeOrmRepository } from './infrastructure/persistence/documents/section.typeorm.repository';
import { DocumentsController } from './presentation/documents/documents.controller';
import { SectionsController } from './presentation/documents/sections.controller';
import { UsersModule } from './users.module';

/**
 * Roadmap item 2 — documents + sections (PG). Mirrors `ConnectorsModule`'s
 * shape: JwtAuthGuard/JwtStrategy come from `UsersModule`; repository
 * interfaces are exported so item 4 (versioning, Mongo) can validate a PG
 * document/section id exists before writing a Mongo document.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentOrmEntity, SectionOrmEntity]),
    UsersModule,
  ],
  controllers: [DocumentsController, SectionsController],
  providers: [
    { provide: DOCUMENT_REPOSITORY, useClass: DocumentTypeOrmRepository },
    { provide: SECTION_REPOSITORY, useClass: SectionTypeOrmRepository },
    CreateDocumentUseCase,
    ListDocumentsUseCase,
    GetDocumentUseCase,
    UpdateDocumentUseCase,
    DeleteDocumentUseCase,
    CreateSectionUseCase,
    ListSectionsUseCase,
    GetSectionUseCase,
    UpdateSectionUseCase,
    DeleteSectionUseCase,
    ReorderSectionsUseCase,
  ],
  exports: [DOCUMENT_REPOSITORY, SECTION_REPOSITORY],
})
export class DocumentsModule {}
