import { Template } from './template.entity';

export const TEMPLATE_REPOSITORY = Symbol('TemplateRepository');

export interface TemplateSectionData {
  title: string;
  order: number;
  wordCountMin: number;
  wordCountMax: number;
  isRequired: boolean;
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
  update(id: string, patch: UpdateTemplateData): Promise<Template>;
  delete(id: string): Promise<void>;
}
