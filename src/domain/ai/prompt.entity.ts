/**
 * Domain entity for `prompts` (see docs/database-schema.md). Plain
 * TypeScript — no typeorm imports. Managed through the admin routes
 * (`/admin/prompts`) and looked up by feature type at generation time.
 */
export class Prompt {
  id: string;
  featureType: string;
  version: string;
  /** Rendered into the system message. Stored in `system_template`. */
  systemTemplate: string;
  /**
   * The USER message template. The DB column keeps its original name
   * `template`; it is not the system prompt.
   */
  template: string;
  /** Copied from the feature type's definition, never from a client. */
  userInvocable: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: {
    id: string;
    featureType: string;
    version: string;
    systemTemplate: string;
    template: string;
    userInvocable: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = props.id;
    this.featureType = props.featureType;
    this.version = props.version;
    this.systemTemplate = props.systemTemplate;
    this.template = props.template;
    this.userInvocable = props.userInvocable;
    this.isActive = props.isActive;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
