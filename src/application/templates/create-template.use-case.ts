import { Inject, Injectable } from '@nestjs/common';
import { Template } from '../../domain/templates/template.entity';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import type { TemplateRepository } from '../../domain/templates/template.repository';
import {
  TemplateSectionInput,
  toTemplateSectionData,
} from './template-section-input';

export interface CreateTemplateInput {
  userId: string;
  title: string;
  docType: string;
  scope: string;
  styleConfig?: Record<string, unknown>;
  isPublished?: boolean;
  sections: TemplateSectionInput[];
}

@Injectable()
export class CreateTemplateUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY)
    private readonly templateRepository: TemplateRepository,
  ) {}

  async execute(input: CreateTemplateInput): Promise<Template> {
    return this.templateRepository.create({
      title: input.title,
      docType: input.docType,
      scope: input.scope,
      createdBy: input.userId,
      styleConfig: input.styleConfig ?? null,
      isPublished: input.isPublished ?? false,
      sections: input.sections.map(toTemplateSectionData),
    });
  }
}
