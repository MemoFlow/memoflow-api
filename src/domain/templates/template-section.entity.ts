/**
 * Domain entity for `template_sections` (see docs/database-schema.md). Note
 * `title` is a deliberate addition beyond the schema doc: sections created
 * from a template need headings (see the `CreateTemplates` migration).
 * Plain TypeScript — no typeorm imports.
 */
export class TemplateSection {
  id: string;
  templateId: string;
  title: string;
  order: number;
  wordCountMin: number;
  wordCountMax: number;
  isRequired: boolean;
  /** Authoring hints shown with the section; never copied into documents. */
  keyPoints: string[] | null;
  guidance: string | null;

  constructor(props: {
    id: string;
    templateId: string;
    title: string;
    order: number;
    wordCountMin: number;
    wordCountMax: number;
    isRequired: boolean;
    keyPoints: string[] | null;
    guidance: string | null;
  }) {
    this.id = props.id;
    this.templateId = props.templateId;
    this.title = props.title;
    this.order = props.order;
    this.wordCountMin = props.wordCountMin;
    this.wordCountMax = props.wordCountMax;
    this.isRequired = props.isRequired;
    this.keyPoints = props.keyPoints;
    this.guidance = props.guidance;
  }
}
