import { toTemplateSectionData } from './template-section-input';

const base = { title: 'Intro', order: 0, wordCountMin: 1, wordCountMax: 2 };

describe('toTemplateSectionData', () => {
  it('carries keyPoints and guidance through', () => {
    expect(
      toTemplateSectionData({
        ...base,
        isRequired: true,
        keyPoints: ['a', 'b'],
        guidance: 'Write well',
      }),
    ).toEqual({
      ...base,
      isRequired: true,
      keyPoints: ['a', 'b'],
      guidance: 'Write well',
    });
  });

  it('defaults omitted keyPoints, guidance and isRequired', () => {
    expect(toTemplateSectionData(base)).toEqual({
      ...base,
      isRequired: false,
      keyPoints: null,
      guidance: null,
    });
  });
});
