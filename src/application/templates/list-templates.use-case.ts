import { Inject, Injectable } from '@nestjs/common';
import { Template } from '../../domain/templates/template.entity';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import type { TemplateRepository } from '../../domain/templates/template.repository';

export interface ListTemplatesInput {
  userId: string;
  docType?: string;
  scope?: string;
}

/** Visible = published OR owned by the requesting user. */
@Injectable()
export class ListTemplatesUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY)
    private readonly templateRepository: TemplateRepository,
  ) {}

  async execute(input: ListTemplatesInput): Promise<Template[]> {
    return this.templateRepository.findVisible(input.userId, {
      docType: input.docType,
      scope: input.scope,
    });
  }
}
