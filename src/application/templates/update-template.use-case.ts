import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Template } from '../../domain/templates/template.entity';
import { UserRole } from '../../domain/users/user-role';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import type { TemplateRepository } from '../../domain/templates/template.repository';
import { assertTemplateEditable } from './template-access';
import {
  TemplateSectionInput,
  toTemplateSectionData,
} from './template-section-input';

export interface UpdateTemplateInput {
  userId: string;
  role: UserRole;
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
 * Owner or admin: `createdBy` must match the requesting user unless the
 * user is an admin. System templates (`createdBy === null`) are editable by
 * admins only. Non-admins cannot publish a template, nor modify one that is
 * already published.
 */
@Injectable()
export class UpdateTemplateUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY)
    private readonly templateRepository: TemplateRepository,
  ) {}

  async execute(input: UpdateTemplateInput): Promise<Template> {
    const template = await this.templateRepository.findById(input.templateId);
    const editable = assertTemplateEditable(
      template,
      input.userId,
      input.templateId,
      input.role,
    );

    if (input.role !== UserRole.Admin) {
      if (editable.isPublished) {
        throw new ForbiddenException(
          'Only an admin can modify a published template',
        );
      }
      if (input.patch.isPublished) {
        throw new ForbiddenException('Only an admin can publish a template');
      }
    }

    const { sections, ...rest } = input.patch;
    return this.templateRepository.update(input.templateId, {
      ...rest,
      sections: sections?.map(toTemplateSectionData),
    });
  }
}
