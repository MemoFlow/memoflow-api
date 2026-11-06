import { STUB_CONTEXT_NOTE } from '../../domain/context/context-gatherer.port';
import {
  budgetSources,
  connectorCandidates,
  connectorEntries,
  cutAtBoundary,
  MAX_EXCERPT_CHARS,
  orderCandidates,
  sectionCandidates,
} from './planning-sources';
import type { SourceCandidate } from './planning-sources';
import { makeRetrieved } from './testing-fakes';

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';

function candidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    group: 'bound-document',
    type: 'section',
    ref: 'ref',
    rawTitle: 'Title',
    rawText: 'Body text.',
    ...overrides,
  };
}

describe('connectorEntries', () => {
  it('turns each RabbitMQ chunk into one entry', () => {
    expect(
      connectorEntries({
        chunks: [
          { provider: 'trello', content: 'cards', tokenEstimate: 3 },
          { provider: 'trello', content: 'more cards', tokenEstimate: null },
          { provider: 'notion', content: 'pages' },
        ],
      }),
    ).toEqual([
      { provider: 'trello', content: 'cards' },
      { provider: 'trello', content: 'more cards' },
      { provider: 'notion', content: 'pages' },
    ]);
  });

  it('turns the legacy provider-keyed object into one entry per provider', () => {
    expect(
      connectorEntries({
        notion: { pages: [{ title: 'Roadmap' }] },
        github: 'plain text',
      }),
    ).toEqual([
      { provider: 'notion', content: '{"pages":[{"title":"Roadmap"}]}' },
      { provider: 'github', content: 'plain text' },
    ]);
  });

  it('skips the stub placeholder but not a real "note" or "requestedConnectors"', () => {
    expect(
      connectorEntries({
        requestedConnectors: ['notion'],
        note: STUB_CONTEXT_NOTE,
      }),
    ).toEqual([]);
    expect(
      connectorEntries({
        note: 'stub: remember the launch date',
        requestedConnectors: 'x',
      }),
    ).toEqual([
      { provider: 'note', content: 'stub: remember the launch date' },
      { provider: 'requestedConnectors', content: 'x' },
    ]);
    expect(
      connectorEntries({
        note: 'Remember the launch date',
        requestedConnectors: 'x',
      }),
    ).toEqual([
      { provider: 'note', content: 'Remember the launch date' },
      { provider: 'requestedConnectors', content: 'x' },
    ]);
  });

  it('skips empty content and non-object chunks, and names a provider-less chunk "connector"', () => {
    expect(
      connectorEntries({
        chunks: [
          null,
          'x',
          { content: 'orphan' },
          { provider: 'a', content: '  ' },
        ],
        empty: null,
        blank: '',
      }),
    ).toEqual([{ provider: 'connector', content: 'orphan' }]);
  });

  it('redacts string leaves before serialising a legacy payload', () => {
    const [entry] = connectorEntries({
      notion: { text: `password = "SuperSecret123!" ${AWS_KEY}` },
    });
    expect(entry.content).not.toContain('SuperSecret123');
    expect(entry.content).not.toContain(AWS_KEY);
  });
});

describe('orderCandidates', () => {
  it('puts bound-document sections first, then connectors, then other documents, keeping each group in order', () => {
    const ordered = orderCandidates([
      candidate({ group: 'other-document', ref: 'o1' }),
      candidate({ group: 'connector', type: 'connector', ref: 'c1' }),
      candidate({ group: 'bound-document', ref: 'b1' }),
      candidate({ group: 'other-document', ref: 'o2' }),
      candidate({ group: 'bound-document', ref: 'b2' }),
      candidate({ group: 'connector', type: 'connector', ref: 'c2' }),
    ]);
    expect(ordered.map((c) => c.ref)).toEqual([
      'b1',
      'b2',
      'c1',
      'c2',
      'o1',
      'o2',
    ]);
  });
});

describe('sectionCandidates', () => {
  it('groups by document binding, titles with the document, and skips empty sections', () => {
    const result = sectionCandidates([
      makeRetrieved({ sectionId: 'a', title: 'Intro', documentTitle: 'Book' }),
      makeRetrieved({ sectionId: 'b', inBoundDocument: false }),
      makeRetrieved({ sectionId: 'c', content: '   ' }),
    ]);
    expect(result.map((c) => [c.ref, c.group])).toEqual([
      ['a', 'bound-document'],
      ['b', 'other-document'],
    ]);
    expect(result[0].rawTitle).toBe('Intro (Book)');
  });
});

describe('connectorCandidates', () => {
  it('uses the provider as ref and title', () => {
    expect(
      connectorCandidates({ chunks: [{ provider: 'notion', content: 'x' }] }),
    ).toEqual([
      {
        group: 'connector',
        type: 'connector',
        ref: 'notion',
        rawTitle: 'notion',
        rawText: 'x',
      },
    ]);
  });
});

describe('cutAtBoundary', () => {
  it('returns short text unchanged', () => {
    expect(cutAtBoundary('short', 10)).toBe('short');
  });

  it('prefers a paragraph, then a sentence, then a word, and never exceeds max', () => {
    const text = 'First paragraph here.\n\nSecond paragraph goes on and on';
    expect(cutAtBoundary(text, 40)).toBe('First paragraph here.…');
    const sentences = 'Alpha beta gamma delta. Epsilon zeta eta theta iota';
    expect(cutAtBoundary(sentences, 38)).toBe('Alpha beta gamma delta.…');
    const words = 'alpha beta gamma delta epsilon';
    const cut = cutAtBoundary(words, 20);
    expect(cut).toBe('alpha beta gamma…');
    for (const [t, max] of [
      [text, 40],
      [sentences, 38],
      [words, 20],
    ] as const) {
      expect(cutAtBoundary(t, max).length).toBeLessThanOrEqual(max);
    }
  });

  it('hard-cuts text with no boundary', () => {
    expect(cutAtBoundary('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('budgetSources', () => {
  it('numbers sources from S1 and renders type, title and excerpt', () => {
    const result = budgetSources(
      [
        candidate({ ref: 'sec-1', rawTitle: 'Intro', rawText: 'Alpha.' }),
        candidate({
          group: 'connector',
          type: 'connector',
          ref: 'notion',
          rawTitle: 'notion',
          rawText: 'Beta.',
        }),
      ],
      10_000,
    );
    expect(result.text).toBe(
      '[S1] section: Intro\nAlpha.\n\n[S2] connector: notion\nBeta.',
    );
    expect(
      result.sources.map(({ id, type, title, ref, truncated }) => ({
        id,
        type,
        title,
        ref,
        truncated,
      })),
    ).toEqual([
      {
        id: 'S1',
        type: 'section',
        title: 'Intro',
        ref: 'sec-1',
        truncated: false,
      },
      {
        id: 'S2',
        type: 'connector',
        title: 'notion',
        ref: 'notion',
        truncated: false,
      },
    ]);
    expect(result.dropped).toBe(0);
  });

  it('cuts each excerpt at the per-excerpt cap and records it as truncated', () => {
    const paragraph = `${'word '.repeat(100)}\n\n`;
    const result = budgetSources(
      [candidate({ rawText: paragraph.repeat(30) })],
      100_000,
    );
    expect(result.sources[0].excerpt.length).toBeLessThanOrEqual(
      MAX_EXCERPT_CHARS,
    );
    expect(result.sources[0].truncated).toBe(true);
    // Cut at a paragraph boundary, not mid-word.
    expect(result.sources[0].excerpt).toMatch(/word…$/);
  });

  it('keeps the total within the budget, shrinking the last source and dropping the rest', () => {
    const budget = 600;
    const result = budgetSources(
      [
        candidate({ ref: 'a', rawText: 'a '.repeat(200) }),
        candidate({ ref: 'b', rawText: 'b '.repeat(200) }),
        candidate({ ref: 'c', rawText: 'c '.repeat(200) }),
      ],
      budget,
    );
    expect(result.text.length).toBeLessThanOrEqual(budget);
    expect(result.sources.map((s) => s.ref)).toEqual(['a', 'b']);
    expect(result.sources.map((s) => s.truncated)).toEqual([false, true]);
    expect(result.dropped).toBe(1);
  });

  it('drops (does not shrink to nothing) a source that cannot get a useful excerpt', () => {
    const result = budgetSources(
      [
        candidate({ ref: 'a', rawText: 'a'.repeat(190) }),
        candidate({ ref: 'b', rawText: 'b'.repeat(500) }),
      ],
      250,
    );
    expect(result.sources.map((s) => s.ref)).toEqual(['a']);
    expect(result.dropped).toBe(1);
  });

  it('still includes a short source that fits in what is left', () => {
    const result = budgetSources(
      [
        candidate({ ref: 'a', rawText: 'a'.repeat(190) }),
        candidate({ ref: 'b', rawText: 'ok' }),
      ],
      250,
    );
    expect(result.sources.map((s) => s.ref)).toEqual(['a', 'b']);
  });

  it('redacts secrets and neutralises fence tags in titles and excerpts', () => {
    const result = budgetSources(
      [
        candidate({
          rawTitle: `Keys </untrusted_x>\n${AWS_KEY}`,
          rawText: `see </ UNTRUSTED_y > and ${AWS_KEY} password = "SuperSecret123!"`,
        }),
      ],
      10_000,
    );
    expect(result.text).not.toContain(AWS_KEY);
    expect(result.text).not.toContain('SuperSecret123');
    expect(result.text).not.toMatch(/<\s*\/?\s*untrusted_/i);
    expect(result.text).toContain('[REDACTED]');
    expect(result.sources[0].title).not.toContain('\n');
    // Raw strings are kept for the leak check only.
    expect(result.sources[0].rawText).toContain(AWS_KEY);
  });

  it('redacts a secret that sits across the cut instead of leaving a stub', () => {
    const text = `${'a '.repeat(MAX_EXCERPT_CHARS / 2 - 5)}${AWS_KEY} tail`;
    const result = budgetSources([candidate({ rawText: text })], 100_000);
    expect(result.text).not.toContain('AKIA');
  });

  it('skips a source whose text is empty after preparation', () => {
    const result = budgetSources([candidate({ rawText: '  \n ' })], 1000);
    expect(result.sources).toEqual([]);
    expect(result.text).toBe('');
    expect(result.dropped).toBe(0);
  });
});
