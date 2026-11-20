import { Inject, Injectable } from '@nestjs/common';
import { Template } from '../../domain/templates/template.entity';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import type { TemplateRepository } from '../../domain/templates/template.repository';

export const DEFAULT_TEMPLATE_PAGE_SIZE = 20;
export const MAX_TEMPLATE_PAGE_SIZE = 100;
export const MAX_TEMPLATE_OFFSET = 100_000;

export interface ListTemplatesInput {
  userId: string;
  docType?: string;
  scope?: string;
  /** 1..100, default 20. */
  limit?: number;
  /** >= 0, default 0. */
  offset?: number;
}

/** Visible = published OR owned by the requesting user. */
@Injectable()
export class ListTemplatesUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY)
    private readonly templateRepository: TemplateRepository,
  ) {}

  async execute(input: ListTemplatesInput): Promise<Template[]> {
    return this.templateRepository.findVisible(
      input.userId,
      { docType: input.docType, scope: input.scope },
      {
        limit: Math.min(
          Math.max(input.limit ?? DEFAULT_TEMPLATE_PAGE_SIZE, 1),
          MAX_TEMPLATE_PAGE_SIZE,
        ),
        offset: Math.max(input.offset ?? 0, 0),
      },
    );
  }
}
