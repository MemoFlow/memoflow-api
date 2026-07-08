import { Inject, Injectable } from '@nestjs/common';
import { Document } from '../../domain/documents/document.entity';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';

@Injectable()
export class ListDocumentsUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
  ) {}

  async execute(userId: string): Promise<Document[]> {
    return this.documentRepository.findByUser(userId);
  }
}
