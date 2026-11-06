import { NotFoundException } from '@nestjs/common';
import { UserRole } from '../../domain/users/user-role';
import { Template } from '../../domain/templates/template.entity';

/**
 * Published templates are visible to everyone; unpublished ones only to
 * their creating user. System templates (`createdBy === null`) are visible
 * only when published. A missing template and an invisible one both 404 —
 * never leaking existence. Shared by get/list/apply-template use-cases.
 */
export function assertTemplateVisible(
  template: Template | null,
  userId: string,
  templateId: string,
): Template {
  if (!template || (!template.isPublished && template.createdBy !== userId)) {
    throw new NotFoundException(`Template ${templateId} not found`);
  }
  return template;
}

/**
 * The creating user may mutate a template; an admin may mutate any template,
 * including system ones (`createdBy === null`). Everyone else gets a 404 —
 * never leaking existence — and system templates are never editable by a
 * non-admin. Shared by update/delete-template use-cases.
 */
export function assertTemplateEditable(
  template: Template | null,
  userId: string,
  templateId: string,
  role: UserRole,
): Template {
  if (!template) {
    throw new NotFoundException(`Template ${templateId} not found`);
  }
  if (role === UserRole.Admin) {
    return template;
  }
  if (template.createdBy === null || template.createdBy !== userId) {
    throw new NotFoundException(`Template ${templateId} not found`);
  }
  return template;
}
