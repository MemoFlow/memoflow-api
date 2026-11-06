import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TEMPLATE_DELETED_EVENT } from '../../domain/audit/audit-events';
import type { TemplateAuditEventPayload } from '../../domain/audit/audit-events';
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
    private readonly eventEmitter: EventEmitter2,
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
    const payload: TemplateAuditEventPayload = {
      userId: input.userId,
      templateId: input.templateId,
    };
    this.eventEmitter.emit(TEMPLATE_DELETED_EVENT, payload);
  }
}
