/**
 * Pure comparison helpers for `scripts/load-template-content.ts` (the
 * owner-run tool that loads the starter template content through the HTTP
 * API). They live under `src/` only so Jest (rootDir `src`) picks up their
 * spec; nothing in the application imports them and they expose no runtime
 * behaviour. Differences are reported as field names only, never values.
 */

/** One section as written in `docs/plans/2026-11-06-template-content.json`. */
export interface ExpectedTemplateSection {
  title: string;
  order: number;
  wordCountMin: number;
  wordCountMax: number;
  isRequired?: boolean;
  keyPoints?: string[] | null;
  guidance?: string | null;
}

/** One template as written in the content JSON file. */
export interface ExpectedTemplate {
  title: string;
  docType: string;
  scope: string;
  isPublished: boolean;
  sections: ExpectedTemplateSection[];
}

/** A section as returned by the API (snake_case response DTO). */
export interface ActualTemplateSection {
  title: string;
  order: number;
  word_count_min: number;
  word_count_max: number;
  is_required: boolean;
  key_points?: string[] | null;
  guidance?: string | null;
}

/** A template as returned by the API (only the fields compared here). */
export interface ActualTemplate {
  title: string;
  doc_type: string;
  scope: string;
  is_published: boolean;
  sections: ActualTemplateSection[];
}

function sameStringArray(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * True when the template has at least one section and every section carries
 * the `key_points` and `guidance` properties (even as null). An API build that
 * predates these fields strips them from responses, so the properties are
 * absent entirely. Zero sections prove nothing, so they return false.
 */
export function storesTemplateContentFields(
  sections: ActualTemplateSection[],
): boolean {
  return (
    sections.length > 0 &&
    sections.every(
      (section) =>
        Object.prototype.hasOwnProperty.call(section, 'key_points') &&
        Object.prototype.hasOwnProperty.call(section, 'guidance'),
    )
  );
}

/**
 * Compares the sections of a template read back from the API against the
 * expected content, section by section (title, doc type and scope are only
 * used by the script to find the template, and are not compared) (ids are ignored: PATCH replaces them). Returns a list
 * of human-readable differences, naming the template/section and the field
 * only; an empty list means they match. Missing `keyPoints`/`guidance` in the
 * expected content are treated as null, as the API does.
 */
export function compareTemplateContent(
  expected: ExpectedTemplate,
  actual: ActualTemplate,
): string[] {
  const differences: string[] = [];

  const expectedSections = [...expected.sections].sort(
    (a, b) => a.order - b.order,
  );
  const actualSections = [...actual.sections].sort((a, b) => a.order - b.order);

  if (expectedSections.length !== actualSections.length) {
    differences.push(
      `section count differs (expected ${expectedSections.length}, got ${actualSections.length})`,
    );
  }

  const shared = Math.min(expectedSections.length, actualSections.length);
  for (let i = 0; i < shared; i++) {
    const want = expectedSections[i];
    const got = actualSections[i];
    const label = `section #${i} ("${want.title}")`;
    const check = (field: string, same: boolean): void => {
      if (!same) differences.push(`${label}: ${field} differs`);
    };

    check('title', got.title === want.title);
    check('order', got.order === want.order);
    check('word_count_min', got.word_count_min === want.wordCountMin);
    check('word_count_max', got.word_count_max === want.wordCountMax);
    check('is_required', got.is_required === (want.isRequired ?? false));
    check(
      'key_points',
      sameStringArray(want.keyPoints ?? null, got.key_points ?? null),
    );
    check('guidance', (want.guidance ?? null) === (got.guidance ?? null));
  }

  return differences;
}
