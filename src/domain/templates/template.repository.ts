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

export interface TemplatePage {
  limit: number;
  offset: number;
}

export interface CreateTemplateOptions {
  /**
   * Max templates the creator may own (`created_by`). Enforced in the same
   * transaction that locks the creator's user row, then counts, then inserts
   * — so concurrent creates can't overshoot. `null`/omitted = unlimited
   * (admins, system templates). Over the cap: `LimitReachedError`.
   */
  maxPerUser?: number | null;
}

export interface TemplateRepository {
  create(
    data: CreateTemplateData,
    options?: CreateTemplateOptions,
  ): Promise<Template>;
  /** Includes the template's sections, ordered by `order` ASC. */
  findById(id: string): Promise<Template | null>;
  /**
   * Visible = `is_published` OR `created_by = userId`, optionally narrowed
   * by `docType`/`scope`. Stable order (`created_at` DESC, `id` ASC), paged.
   */
  findVisible(
    userId: string,
    filters: TemplateFilters,
    page: TemplatePage,
  ): Promise<Template[]>;
  update(
    id: string,
    patch: UpdateTemplateData,
    options?: UpdateTemplateOptions,
  ): Promise<Template>;
  delete(id: string): Promise<void>;
}
