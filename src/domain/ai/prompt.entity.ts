/**
 * Domain entity for `prompts` (see docs/database-schema.md). Plain
 * TypeScript — no typeorm imports. No public controller: prompts are looked
 * up internally by `generate-suggestion` (active prompt per feature type)
 * and seeded via `scripts/seed.ts`.
 */
export class Prompt {
  id: string;
  featureType: string;
  version: string;
  template: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: {
    id: string;
    featureType: string;
    version: string;
    template: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = props.id;
    this.featureType = props.featureType;
    this.version = props.version;
    this.template = props.template;
    this.isActive = props.isActive;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
