/**
 * Controlled vocabulary for `templates.scope`. `global` templates are
 * admin-only (enforced in the create/update use-cases).
 */
export const TEMPLATE_SCOPES = ['personal', 'org', 'global'] as const;

export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export const GLOBAL_TEMPLATE_SCOPE: TemplateScope = 'global';
