import { Document } from './document.entity';

export const DOCUMENT_REPOSITORY = Symbol('DocumentRepository');

export interface CreateDocumentData {
  userId: string;
  title: string;
  docType: string;
  status: string;
  styleConfig: Record<string, unknown>;
}

export interface UpdateDocumentData {
  title?: string;
  docType?: string;
  status?: string;
  styleConfig?: Record<string, unknown>;
}

export interface DocumentRepository {
  create(data: CreateDocumentData): Promise<Document>;
  findById(id: string): Promise<Document | null>;
  findByUser(userId: string): Promise<Document[]>;
  update(id: string, patch: UpdateDocumentData): Promise<Document>;
  delete(id: string): Promise<void>;
}
