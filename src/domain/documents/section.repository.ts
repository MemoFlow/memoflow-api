import { Section } from './section.entity';

export const SECTION_REPOSITORY = Symbol('SectionRepository');

export interface CreateSectionData {
  documentId: string;
  title: string;
  content: string;
  order: number;
  status: string;
  wordCount: number;
}

export interface UpdateSectionData {
  title?: string;
  content?: string;
  status?: string;
  wordCount?: number;
  order?: number;
}

export interface SectionRepository {
  create(data: CreateSectionData): Promise<Section>;
  findById(id: string): Promise<Section | null>;
  /** Ordered by `order` ASC. */
  findByDocument(documentId: string): Promise<Section[]>;
  update(id: string, patch: UpdateSectionData): Promise<Section>;
  delete(id: string): Promise<void>;
  maxOrder(documentId: string): Promise<number | null>;
  /**
   * Sets each section's `order` to its index within `orderedIds`, in a
   * single transaction.
   */
  reorder(documentId: string, orderedIds: string[]): Promise<void>;
}
