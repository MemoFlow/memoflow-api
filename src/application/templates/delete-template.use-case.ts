import { Inject, Injectable } from '@nestjs/common';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import type { TemplateRepository } from '../../domain/templates/template.repository';
import { assertTemplateEditable } from './template-access';

export interface DeleteTemplateInput {
  userId: string;
  templateId: string;
}

/** Owner-only, same rule as `UpdateTemplateUseCase`. */
@Injectable()
export class DeleteTemplateUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY)
    private readonly templateRepository: TemplateRepository,
  ) {}

  async execute(input: DeleteTemplateInput): Promise<void> {
    const template = await this.templateRepository.findById(input.templateId);
    assertTemplateEditable(template, input.userId, input.templateId);
    await this.templateRepository.delete(input.templateId);
  }
}
