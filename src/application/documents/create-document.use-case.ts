import { Inject, Injectable } from '@nestjs/common';
import { Document } from '../../domain/documents/document.entity';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';

export interface CreateDocumentInput {
  userId: string;
  title: string;
  docType: string;
  status?: string;
  styleConfig?: Record<string, unknown>;
}

@Injectable()
export class CreateDocumentUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
  ) {}

  async execute(input: CreateDocumentInput): Promise<Document> {
    return this.documentRepository.create({
      userId: input.userId,
      title: input.title,
      docType: input.docType,
      status: input.status ?? 'draft',
      styleConfig: input.styleConfig ?? {},
    });
  }
}
