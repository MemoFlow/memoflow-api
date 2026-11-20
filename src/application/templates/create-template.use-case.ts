import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  TEMPLATE_CREATED_EVENT,
  TEMPLATE_PUBLISHED_EVENT,
} from '../../domain/audit/audit-events';
import type { TemplateAuditEventPayload } from '../../domain/audit/audit-events';
import { STORAGE_LIMITS } from '../../domain/limits/storage-limits';
import type { StorageLimits } from '../../domain/limits/storage-limits';
import { GLOBAL_TEMPLATE_SCOPE } from '../../domain/templates/template-scopes';
import { conflictOnLimit } from '../shared/limit-conflict';
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
    @Inject(STORAGE_LIMITS) private readonly limits: StorageLimits,
  ) {}

  async execute(input: CreateTemplateInput): Promise<Template> {
    if (input.isPublished && input.role !== UserRole.Admin) {
      throw new ForbiddenException('Only an admin can publish a template');
    }
    if (
      input.scope === GLOBAL_TEMPLATE_SCOPE &&
      input.role !== UserRole.Admin
    ) {
      throw new ForbiddenException(
        "Only an admin can create a template with scope 'global'",
      );
    }
    // Admins are exempt from the per-user template cap; everyone else is
    // capped inside the repository (user-row lock + count + insert).
    const template = await conflictOnLimit(() =>
      this.templateRepository.create(
        {
          title: input.title,
          docType: input.docType,
          scope: input.scope,
          createdBy: input.userId,
          styleConfig: input.styleConfig ?? null,
          isPublished: input.isPublished ?? false,
          sections: input.sections.map(toTemplateSectionData),
        },
        {
          maxPerUser:
            input.role === UserRole.Admin
              ? null
              : this.limits.maxTemplatesPerUser,
        },
      ),
    );
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
