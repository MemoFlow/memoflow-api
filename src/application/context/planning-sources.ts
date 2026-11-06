import {
  prepareUntrustedText,
  prepareUntrustedValue,
} from '../../domain/ai/prompt-guards';
import { STUB_CONTEXT_NOTE } from '../../domain/context/context-gatherer.port';
import type { RetrievedSection } from '../../domain/context/section-retriever.port';

/** Longest excerpt of any one source, in characters. */
export const MAX_EXCERPT_CHARS = 4000;
/** Longest title shown for a source. */
export const MAX_SOURCE_TITLE_CHARS = 200;
/**
 * Text is cut to this before redaction, bounding regex work on a huge
 * section or connector chunk. It is far above `MAX_EXCERPT_CHARS`, so a
 * secret is redacted well before the cut that decides what the model sees.
 */
const MAX_PREPARE_CHARS = 50_000;
/** A source is dropped rather than shown with less room than this. */
const MIN_EXCERPT_CHARS = 100;
const ELLIPSIS = '…';

export type PlanningSourceType = 'section' | 'connector';

/** Where a source sits in the budget order. */
type SourceGroup = 'bound-document' | 'connector' | 'other-document';

/** A source before budgeting: raw strings, in the user's own words. */
export interface SourceCandidate {
  group: SourceGroup;
  type: PlanningSourceType;
  /** Section id or provider. */
  ref: string;
  rawTitle: string;
  rawText: string;
}

/** What is stored and returned about a used source: never its text. */
export interface PlanningSourceMeta {
  id: string;
  type: PlanningSourceType;
  title: string;
  ref: string;
  truncated: boolean;
}

export interface BudgetedSource extends PlanningSourceMeta {
  /** Prepared (redacted, fence-safe) and cut. */
  excerpt: string;
  rawTitle: string;
  rawText: string;
}

export interface BudgetResult {
  sources: BudgetedSource[];
  /** Candidates left out because the budget ran out. */
  dropped: number;
  /** Rendered `[S1] ...` blocks, ready for the `{{context}}` placeholder. */
  text: string;
}

/** A connector chunk (RabbitMQ) or provider entry (legacy gatherer). */
interface ConnectorEntry {
  provider: string;
  content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contentToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    // Redact the string leaves before serialising: once serialised, quotes
    // are escaped and a quoted secret would slip past the patterns.
    return JSON.stringify(prepareUntrustedValue(value, MAX_PREPARE_CHARS));
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/**
 * Normalises connector context to one entry per chunk (RabbitMQ shape,
 * `{ chunks: [{ provider, content }] }`) or per provider (legacy gatherer
 * shape, `{ <provider>: <payload> }`). The stub gatherer's placeholder is
 * skipped: it says nothing about the user's content.
 */
export function connectorEntries(
  context: Record<string, unknown>,
): ConnectorEntry[] {
  const entries: ConnectorEntry[] = [];
  const isStub = context.note === STUB_CONTEXT_NOTE;

  for (const [key, value] of Object.entries(context)) {
    if (key === 'chunks' && Array.isArray(value)) {
      for (const chunk of value) {
        if (!isRecord(chunk)) continue;
        entries.push({
          provider:
            typeof chunk.provider === 'string' && chunk.provider.trim()
              ? chunk.provider
              : 'connector',
          content: contentToString(chunk.content),
        });
      }
      continue;
    }
    if (isStub && (key === 'note' || key === 'requestedConnectors')) continue;
    entries.push({ provider: key, content: contentToString(value) });
  }
  return entries.filter((entry) => entry.content.trim() !== '');
}

export function connectorCandidates(
  context: Record<string, unknown>,
): SourceCandidate[] {
  return connectorEntries(context).map((entry) => ({
    group: 'connector',
    type: 'connector',
    ref: entry.provider,
    rawTitle: entry.provider,
    rawText: entry.content,
  }));
}

export function sectionCandidates(
  sections: RetrievedSection[],
): SourceCandidate[] {
  return sections
    .filter((section) => section.content.trim() !== '')
    .map((section) => ({
      group: section.inBoundDocument ? 'bound-document' : 'other-document',
      type: 'section',
      ref: section.sectionId,
      rawTitle: `${section.title} (${section.documentTitle})`,
      rawText: section.content,
    }));
}

/** Bound-document sections, then connector sources, then other documents. */
export function orderCandidates(
  candidates: SourceCandidate[],
): SourceCandidate[] {
  const rank: Record<SourceGroup, number> = {
    'bound-document': 0,
    connector: 1,
    'other-document': 2,
  };
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        rank[a.candidate.group] - rank[b.candidate.group] || a.index - b.index,
    )
    .map(({ candidate }) => candidate);
}

/**
 * Cuts at a paragraph, line, sentence or word boundary when one is in the
 * last half of the allowance, else hard; the result, with its ellipsis, is
 * never longer than `max`.
 */
export function cutAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = Math.max(max - ELLIPSIS.length, 0);
  const head = text.slice(0, room);
  const floor = Math.floor(room / 2);
  const boundaries = [
    head.lastIndexOf('\n\n'),
    head.lastIndexOf('\n'),
    Math.max(
      head.lastIndexOf('. '),
      head.lastIndexOf('? '),
      head.lastIndexOf('! '),
    ) + 1,
    head.lastIndexOf(' '),
  ];
  const at = boundaries.find((index) => index > floor);
  return `${(at === undefined ? head : head.slice(0, at)).trimEnd()}${ELLIPSIS}`;
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Prepares (redacts, defuses fence tags) every title and excerpt, then
 * applies the budget in the given order: each excerpt at most
 * `MAX_EXCERPT_CHARS`, the whole rendered text at most `maxChars`. Redaction
 * comes before any cut so a secret can't be split into something the
 * patterns no longer recognise.
 */
export function budgetSources(
  candidates: SourceCandidate[],
  maxChars: number,
): BudgetResult {
  const sources: BudgetedSource[] = [];
  const blocks: string[] = [];
  let remaining = maxChars;
  let dropped = 0;

  for (const candidate of candidates) {
    const cappedText = candidate.rawText.slice(0, MAX_PREPARE_CHARS);
    const prepared = prepareUntrustedText(cappedText).trim();
    if (prepared === '') continue;
    const title = cutAtBoundary(
      singleLine(prepareUntrustedText(candidate.rawTitle)),
      MAX_SOURCE_TITLE_CHARS,
    );

    const id = `S${sources.length + 1}`;
    const header = `[${id}] ${candidate.type}: ${title}\n`;
    const separator = blocks.length > 0 ? 2 : 0;
    const room = remaining - separator - header.length;
    if (room < Math.min(MIN_EXCERPT_CHARS, prepared.length)) {
      dropped += 1;
      continue;
    }

    const excerpt = cutAtBoundary(prepared, Math.min(MAX_EXCERPT_CHARS, room));
    const truncated =
      excerpt !== prepared || candidate.rawText.length > MAX_PREPARE_CHARS;
    const block = `${header}${excerpt}`;
    remaining -= separator + block.length;
    blocks.push(block);
    sources.push({
      id,
      type: candidate.type,
      title,
      ref: candidate.ref,
      truncated,
      excerpt,
      rawTitle: candidate.rawTitle,
      rawText: candidate.rawText,
    });
  }

  return { sources, dropped, text: blocks.join('\n\n') };
}
