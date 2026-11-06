import { Template } from './template.entity';

export const TEMPLATE_REPOSITORY = Symbol('TemplateRepository');

export interface TemplateSectionData {
  title: string;
  order: number;
  wordCountMin: number;
  wordCountMax: number;
  isRequired: boolean;
  keyPoints: string[] | null;
  guidance: string | null;
}

export interface CreateTemplateData {
  title: string;
  docType: string;
  scope: string;
  createdBy: string | null;
  styleConfig: Record<string, unknown> | null;
  isPublished: boolean;
  sections: TemplateSectionData[];
}

export interface UpdateTemplateData {
  title?: string;
  docType?: string;
  scope?: string;
  styleConfig?: Record<string, unknown>;
  isPublished?: boolean;
  /** When present, REPLACES all of the template's sections wholesale. */
  sections?: TemplateSectionData[];
}

export interface UpdateTemplateOptions {
  /**
   * Refuse the update (with `TemplatePublishedError`) if the stored row is
   * published at write time. Evaluated under a row lock, so a concurrent
   * publish cannot be overwritten by a stale application-level check.
   */
  onlyIfUnpublished?: boolean;
}

/** The template was published (possibly concurrently) and the caller may not edit it. */
export class TemplatePublishedError extends Error {
  constructor() {
    super('Template is published');
    this.name = 'TemplatePublishedError';
  }
}

export interface TemplateFilters {
  docType?: string;
  scope?: string;
}

export interface TemplateRepository {
  create(data: CreateTemplateData): Promise<Template>;
  /** Includes the template's sections, ordered by `order` ASC. */
  findById(id: string): Promise<Template | null>;
  /**
   * Visible = `is_published` OR `created_by = userId`, optionally narrowed
   * by `docType`/`scope`.
   */
  findVisible(userId: string, filters: TemplateFilters): Promise<Template[]>;
  update(
    id: string,
    patch: UpdateTemplateData,
    options?: UpdateTemplateOptions,
  ): Promise<Template>;
  delete(id: string): Promise<void>;
}
