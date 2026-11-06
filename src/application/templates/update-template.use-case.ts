import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  TEMPLATE_PUBLISHED_EVENT,
  TEMPLATE_UNPUBLISHED_EVENT,
  TEMPLATE_UPDATED_EVENT,
} from '../../domain/audit/audit-events';
import type { TemplateAuditEventPayload } from '../../domain/audit/audit-events';
import { Template } from '../../domain/templates/template.entity';
import { UserRole } from '../../domain/users/user-role';
import { TEMPLATE_REPOSITORY } from '../../domain/templates/template.repository';
import { TemplatePublishedError } from '../../domain/templates/template.repository';
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
    private readonly eventEmitter: EventEmitter2,
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
    let updated: Template;
    try {
      // The early checks above give a fast answer; this makes them hold
      // against a concurrent publish by re-checking under a row lock.
      updated = await this.templateRepository.update(
        input.templateId,
        { ...rest, sections: sections?.map(toTemplateSectionData) },
        { onlyIfUnpublished: input.role !== UserRole.Admin },
      );
    } catch (err) {
      if (err instanceof TemplatePublishedError) {
        throw new ForbiddenException(
          'Only an admin can modify a published template',
        );
      }
      throw err;
    }

    const base: TemplateAuditEventPayload = {
      userId: input.userId,
      templateId: updated.id,
    };
    this.eventEmitter.emit(TEMPLATE_UPDATED_EVENT, {
      ...base,
      changedFields: Object.entries(input.patch)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key),
    });
    if (updated.isPublished !== editable.isPublished) {
      this.eventEmitter.emit(
        updated.isPublished
          ? TEMPLATE_PUBLISHED_EVENT
          : TEMPLATE_UNPUBLISHED_EVENT,
        base,
      );
    }
    return updated;
  }
}
