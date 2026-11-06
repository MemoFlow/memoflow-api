import { suggestionCacheKey } from './suggestion-cache-key';

const base = {
  userId: 'user-1',
  featureType: 'suggestion',
  promptVersion: 'v3',
  modelScope: '["model-a"]',
  content: 'Some section text',
  context: 'Document: Plan',
};

describe('suggestionCacheKey', () => {
  it('is stable for identical input and a hex SHA-256 digest', () => {
    expect(suggestionCacheKey(base)).toBe(suggestionCacheKey({ ...base }));
    expect(suggestionCacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['user', { userId: 'user-2' }],
    ['feature type', { featureType: 'rewrite' }],
    ['prompt version', { promptVersion: 'v4' }],
    ['model identity', { modelScope: '["model-a","model-b"]' }],
    ['section text', { content: 'Some section text!' }],
    ['light context', { context: 'Document: Other' }],
  ])('differs when the %s differs', (_name, change) => {
    expect(suggestionCacheKey({ ...base, ...change })).not.toBe(
      suggestionCacheKey(base),
    );
  });

  it('does not let fields run into each other', () => {
    const a = suggestionCacheKey({ ...base, content: 'ab', context: 'c' });
    const b = suggestionCacheKey({ ...base, content: 'a', context: 'bc' });
    const c = suggestionCacheKey({
      ...base,
      userId: 'user-1x',
      featureType: 'y',
    });
    const d = suggestionCacheKey({
      ...base,
      userId: 'user-1',
      featureType: 'xy',
    });
    expect(a).not.toBe(b);
    expect(c).not.toBe(d);
  });

  it('contains none of its inputs', () => {
    const key = suggestionCacheKey(base);
    for (const value of Object.values(base)) expect(key).not.toContain(value);
  });
});
