import { NotFoundException } from '@nestjs/common';
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
 * Only the creating user may mutate a template. System templates
 * (`createdBy === null`) are never editable, regardless of publish state.
 * Shared by update/delete-template use-cases.
 */
export function assertTemplateEditable(
  template: Template | null,
  userId: string,
  templateId: string,
): Template {
  if (
    !template ||
    template.createdBy === null ||
    template.createdBy !== userId
  ) {
    throw new NotFoundException(`Template ${templateId} not found`);
  }
  return template;
}
