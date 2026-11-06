import { Inject, Injectable } from '@nestjs/common';
import { UserRole } from '../../domain/users/user-role';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import type { TemplateRepository } from '../../domain/templates/template.repository';
import { assertTemplateEditable } from './template-access';

export interface DeleteTemplateInput {
  userId: string;
  role: UserRole;
  templateId: string;
}

/** Owner or admin; a non-admin owner may still delete a published template. */
@Injectable()
export class DeleteTemplateUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY)
    private readonly templateRepository: TemplateRepository,
  ) {}

  async execute(input: DeleteTemplateInput): Promise<void> {
    const template = await this.templateRepository.findById(input.templateId);
    assertTemplateEditable(
      template,
      input.userId,
      input.templateId,
      input.role,
    );
    await this.templateRepository.delete(input.templateId);
  }
}
