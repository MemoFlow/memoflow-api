import type { PlanningResult } from '../../domain/context/llm-planner.port';
import type { PlanningSourceType } from './planning-sources';

/** A source as returned to clients: never its text. */
export interface CitedSource {
  id: string;
  type: PlanningSourceType;
  title: string;
}

export type ValidatedPlanningResult = Omit<PlanningResult, 'sources'> & {
  sources: CitedSource[];
};

/** `S1` or `[S1]`, nothing else. */
const SOURCE_ID = /^\[?\s*S(\d{1,4})\s*\]?$/i;
/** `[S1]`, `[S1, S2]`, with the spaces before it. */
const INLINE_CITATION = /[ \t]*\[\s*S\d{1,4}(?:\s*[,;]\s*S\d{1,4})*\s*\]/gi;
const INLINE_ID = /S(\d{1,4})/gi;

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = SOURCE_ID.exec(value.trim());
  return match ? `S${Number(match[1])}` : null;
}

/** Drops citations of unknown sources from free text, keeps known ones. */
function cleanText(text: string, known: Set<string>): string {
  return text.replace(INLINE_CITATION, (citation: string) => {
    const ids = [...citation.matchAll(INLINE_ID)]
      .map((m) => `S${Number(m[1])}`)
      .filter((id) => known.has(id));
    return ids.length === 0
      ? ''
      : `${/^\s/.test(citation) ? ' ' : ''}[${[...new Set(ids)].join(', ')}]`;
  });
}

/** A string outline is cleaned, and is null if nothing is left of it. */
function cleanOutline(outline: unknown, known: Set<string>): unknown {
  if (typeof outline !== 'string') return outline;
  const cleaned = cleanText(outline, known);
  return cleaned.trim() === '' ? null : cleaned;
}

/**
 * Makes the model's citations consistent with the sources it was given:
 * `sources` keeps only ids that exist (as `{ id, type, title }`, deduplicated,
 * so no section text can ride along in it) and inline `[S9]` citations of
 * unknown sources are removed from the suggestions and the outline. A string
 * outline is cleaned; any other outline value is kept as is.
 */
export function validateCitations(
  result: PlanningResult,
  sources: ReadonlyArray<CitedSource>,
): ValidatedPlanningResult {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const known = new Set(byId.keys());

  const cited: CitedSource[] = [];
  for (const entry of result.sources) {
    const raw =
      typeof entry === 'object' && entry !== null && 'id' in entry
        ? entry.id
        : entry;
    const id = normalizeId(raw);
    const source = id === null ? undefined : byId.get(id);
    if (source && !cited.some((c) => c.id === source.id)) {
      cited.push({ id: source.id, type: source.type, title: source.title });
    }
  }

  return {
    ...result,
    suggestions: result.suggestions
      .map((suggestion) => cleanText(suggestion, known).trim())
      .filter((suggestion) => suggestion !== ''),
    outline: cleanOutline(result.outline, known),
    sources: cited,
  };
}
