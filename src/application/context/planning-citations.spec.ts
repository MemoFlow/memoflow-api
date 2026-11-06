import type { PlanningResult } from '../../domain/context/llm-planner.port';
import { validateCitations } from './planning-citations';
import type { CitedSource } from './planning-citations';

const sources: CitedSource[] = [
  { id: 'S1', type: 'section', title: 'Intro (Book)' },
  { id: 'S2', type: 'connector', title: 'notion' },
];

function result(overrides: Partial<PlanningResult> = {}): PlanningResult {
  return {
    suggestions: [],
    outline: null,
    sources: [],
    model: 'm',
    ...overrides,
  };
}

describe('validateCitations', () => {
  it('keeps only existing ids, accepts S1 and [S1], returns { id, type, title }, deduplicated', () => {
    const out = validateCitations(
      result({
        sources: ['S1', '[S2]', ' [ S1 ] ', 'S9', '[S10]', 'Intro', 42, null],
      }),
      sources,
    );
    expect(out.sources).toEqual([
      { id: 'S1', type: 'section', title: 'Intro (Book)' },
      { id: 'S2', type: 'connector', title: 'notion' },
    ]);
  });

  it('never lets raw text ride along in sources', () => {
    const out = validateCitations(
      result({
        sources: [
          'S1 the whole secret section content',
          { id: 'S1', content: 'secret section content', title: 'forged' },
        ],
      }),
      sources,
    );
    // The string is not an id; the object is reduced to the known source.
    expect(out.sources).toEqual([
      { id: 'S1', type: 'section', title: 'Intro (Book)' },
    ]);
    expect(JSON.stringify(out.sources)).not.toContain('secret section');
    expect(JSON.stringify(out.sources)).not.toContain('forged');
  });

  it('removes citations of unknown sources from suggestions and outline, keeping known ones', () => {
    const out = validateCitations(
      result({
        suggestions: [
          'Open with the history [S1] and the pricing [S7].',
          '[S9]',
          'Group cite [S1, S9, S2].',
          'Only unknown [S3, S4] here',
        ],
        outline:
          '1. Intro [S2]\n2. Unsupported claim [S12]\n3. Wrap-up [S1] [S5]',
      }),
      sources,
    );
    expect(out.suggestions).toEqual([
      'Open with the history [S1] and the pricing.',
      'Group cite [S1, S2].',
      'Only unknown here',
    ]);
    expect(out.outline).toBe(
      '1. Intro [S2]\n2. Unsupported claim\n3. Wrap-up [S1]',
    );
  });

  it('leaves a non-string outline alone and passes model through', () => {
    const outline = { points: ['a'] };
    const out = validateCitations(result({ outline }), sources);
    expect(out.outline).toBe(outline);
    expect(out.model).toBe('m');
  });

  it('with no sources, drops every citation and every source', () => {
    const out = validateCitations(
      result({
        suggestions: ['Claim [S1].'],
        outline: 'Outline [S1]',
        sources: ['S1'],
      }),
      [],
    );
    expect(out).toMatchObject({
      suggestions: ['Claim.'],
      outline: 'Outline',
      sources: [],
    });
  });

  it('turns an outline left with nothing but removed citations into null', () => {
    expect(
      validateCitations(result({ outline: ' [S4] ' }), sources).outline,
    ).toBeNull();
    expect(
      validateCitations(result({ outline: '[S1]' }), sources).outline,
    ).toBe('[S1]');
  });

  it('does not touch bracketed text that is not a citation', () => {
    const out = validateCitations(
      result({ suggestions: ['See [Section 1] and [S] and [S1x]'] }),
      sources,
    );
    expect(out.suggestions).toEqual(['See [Section 1] and [S] and [S1x]']);
  });
});
