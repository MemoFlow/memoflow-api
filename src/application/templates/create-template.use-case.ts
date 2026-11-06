import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  TEMPLATE_CREATED_EVENT,
  TEMPLATE_PUBLISHED_EVENT,
} from '../../domain/audit/audit-events';
import type { TemplateAuditEventPayload } from '../../domain/audit/audit-events';
import { Template } from '../../domain/templates/template.entity';
import { UserRole } from '../../domain/users/user-role';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import type { TemplateRepository } from '../../domain/templates/template.repository';
import {
  TemplateSectionInput,
  toTemplateSectionData,
} from './template-section-input';

export interface CreateTemplateInput {
  userId: string;
  role: UserRole;
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
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: CreateTemplateInput): Promise<Template> {
    if (input.isPublished && input.role !== UserRole.Admin) {
      throw new ForbiddenException('Only an admin can publish a template');
    }
    const template = await this.templateRepository.create({
      title: input.title,
      docType: input.docType,
      scope: input.scope,
      createdBy: input.userId,
      styleConfig: input.styleConfig ?? null,
      isPublished: input.isPublished ?? false,
      sections: input.sections.map(toTemplateSectionData),
    });
    const payload: TemplateAuditEventPayload = {
      userId: input.userId,
      templateId: template.id,
    };
    this.eventEmitter.emit(TEMPLATE_CREATED_EVENT, payload);
    if (template.isPublished) {
      this.eventEmitter.emit(TEMPLATE_PUBLISHED_EVENT, payload);
    }
    return template;
  }
}
