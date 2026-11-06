import {
  ActualTemplate,
  ExpectedTemplate,
  compareTemplateContent,
  storesTemplateContentFields,
} from './compare-template-content';

const expected: ExpectedTemplate = {
  title: 'T',
  docType: 'thesis',
  scope: 'global',
  isPublished: true,
  sections: [
    {
      title: 'A',
      order: 0,
      wordCountMin: 1,
      wordCountMax: 2,
      isRequired: true,
      keyPoints: ['x', 'y'],
      guidance: 'g',
    },
    { title: 'B', order: 1, wordCountMin: 3, wordCountMax: 4 },
  ],
};

function actualFor(): ActualTemplate {
  return {
    title: 'T',
    doc_type: 'thesis',
    scope: 'global',
    is_published: true,
    sections: [
      {
        title: 'B',
        order: 1,
        word_count_min: 3,
        word_count_max: 4,
        is_required: false,
        key_points: null,
        guidance: null,
      },
      {
        title: 'A',
        order: 0,
        word_count_min: 1,
        word_count_max: 2,
        is_required: true,
        key_points: ['x', 'y'],
        guidance: 'g',
      },
    ],
  };
}

describe('compareTemplateContent', () => {
  it('reports no differences for matching content, regardless of array order', () => {
    expect(compareTemplateContent(expected, actualFor())).toEqual([]);
  });

  it('treats missing expected keyPoints/guidance as null', () => {
    const actual = actualFor();
    actual.sections[0].key_points = undefined;
    expect(compareTemplateContent(expected, actual)).toEqual([]);
  });

  it.each([
    ['key_points', (a: ActualTemplate) => (a.sections[1].key_points = ['x'])],
    [
      'key_points',
      (a: ActualTemplate) => (a.sections[1].key_points = ['y', 'x']),
    ],
    ['guidance', (a: ActualTemplate) => (a.sections[1].guidance = 'other')],
    ['is_required', (a: ActualTemplate) => (a.sections[1].is_required = false)],
    [
      'word_count_min',
      (a: ActualTemplate) => (a.sections[1].word_count_min = 9),
    ],
    [
      'word_count_max',
      (a: ActualTemplate) => (a.sections[1].word_count_max = 9),
    ],
    ['title', (a: ActualTemplate) => (a.sections[1].title = 'Z')],
  ])('names the %s field when it differs', (field, mutate) => {
    const actual = actualFor();
    mutate(actual);
    const diffs = compareTemplateContent(expected, actual);
    expect(diffs).toEqual([`section #0 ("A"): ${field} differs`]);
  });

  it('reports a section count mismatch and ignores template-level fields', () => {
    const actual = actualFor();
    actual.sections.pop();
    actual.scope = 'personal';
    const diffs = compareTemplateContent(expected, actual);
    expect(diffs).not.toContain('scope differs');
    expect(diffs).toContain('section count differs (expected 2, got 1)');
  });

  it('never includes field values in its messages', () => {
    const actual = actualFor();
    actual.sections[1].guidance = 'SECRET-VALUE';
    expect(compareTemplateContent(expected, actual).join('\n')).not.toContain(
      'SECRET-VALUE',
    );
  });
});

describe('storesTemplateContentFields', () => {
  it('is true when key_points and guidance are present, even as null', () => {
    expect(storesTemplateContentFields(actualFor().sections)).toBe(true);
  });

  it('is false for zero sections (nothing to prove)', () => {
    expect(storesTemplateContentFields([])).toBe(false);
  });

  it('is false when an old deploy omits them', () => {
    const sections = [
      {
        title: 'A',
        order: 0,
        word_count_min: 1,
        word_count_max: 2,
        is_required: true,
      },
    ];
    expect(storesTemplateContentFields(sections)).toBe(false);
  });
});
