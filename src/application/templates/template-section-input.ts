import { TemplateSectionData } from '../../domain/templates/template.repository';

/**
 * Application-layer shape for a section within create/update-template
 * requests — `isRequired` is optional here (defaults to `false`), unlike the
 * fully-resolved `TemplateSectionData` the repository interface expects.
 */
export interface TemplateSectionInput {
  title: string;
  order: number;
  wordCountMin: number;
  wordCountMax: number;
  isRequired?: boolean;
}

export function toTemplateSectionData(
  section: TemplateSectionInput,
): TemplateSectionData {
  return {
    title: section.title,
    order: section.order,
    wordCountMin: section.wordCountMin,
    wordCountMax: section.wordCountMax,
    isRequired: section.isRequired ?? false,
  };
}
