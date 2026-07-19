import { Inject, Injectable } from '@nestjs/common';
import { Template } from '../../domain/templates/template.entity';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import type { TemplateRepository } from '../../domain/templates/template.repository';
import { assertTemplateEditable } from './template-access';
import {
  TemplateSectionInput,
  toTemplateSectionData,
} from './template-section-input';

export interface UpdateTemplateInput {
  userId: string;
  templateId: string;
  patch: {
    title?: string;
    docType?: string;
    scope?: string;
    styleConfig?: Record<string, unknown>;
    isPublished?: boolean;
    /** When present, REPLACES all of the template's sections wholesale. */
    sections?: TemplateSectionInput[];
  };
}

/**
 * Owner-only: `createdBy` must match the requesting user. System templates
 * (`createdBy === null`) are never editable through this use-case.
 */
@Injectable()
export class UpdateTemplateUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY)
    private readonly templateRepository: TemplateRepository,
  ) {}

  async execute(input: UpdateTemplateInput): Promise<Template> {
    const template = await this.templateRepository.findById(input.templateId);
    assertTemplateEditable(template, input.userId, input.templateId);

    const { sections, ...rest } = input.patch;
    return this.templateRepository.update(input.templateId, {
      ...rest,
      sections: sections?.map(toTemplateSectionData),
    });
  }
}
