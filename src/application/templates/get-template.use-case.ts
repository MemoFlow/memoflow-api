import { Inject, Injectable } from '@nestjs/common';
import { Template } from '../../domain/templates/template.entity';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import type { TemplateRepository } from '../../domain/templates/template.repository';
import { assertTemplateVisible } from './template-access';

export interface GetTemplateInput {
  userId: string;
  templateId: string;
}

/**
 * Reads a template if it's visible to the requesting user (published or
 * own) — a missing template and an invisible one both 404. Reused by
 * `ApplyTemplateUseCase` for the same visibility check.
 */
@Injectable()
export class GetTemplateUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY)
    private readonly templateRepository: TemplateRepository,
  ) {}

  async execute(input: GetTemplateInput): Promise<Template> {
    const template = await this.templateRepository.findById(input.templateId);
    return assertTemplateVisible(template, input.userId, input.templateId);
  }
}
