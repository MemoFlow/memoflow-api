import { listPlaceholders, renderPrompt } from './prompt-render';

describe('renderPrompt', () => {
  it('substitutes every occurrence', () => {
    expect(renderPrompt('{{a}}-{{b}}-{{a}}', { a: '1', b: '2' })).toBe('1-2-1');
  });

  it.each(['$&', '$1', '$$', "$'", '$`', '$<name>'])(
    'keeps %s in a value literal',
    (value) => {
      expect(renderPrompt('x {{content}} y', { content: value })).toBe(
        `x ${value} y`,
      );
    },
  );

  it('does not re-scan a value that contains a placeholder', () => {
    expect(
      renderPrompt('{{content}} / {{nonce}}', {
        content: 'see {{content}} and {{nonce}}',
        nonce: 'N',
      }),
    ).toBe('see {{content}} and {{nonce}} / N');
  });

  it('throws on an unknown placeholder', () => {
    expect(() => renderPrompt('hi {{nope}}', { content: 'x' })).toThrow(/nope/);
  });

  it('does not treat inherited object keys as variables', () => {
    expect(() => renderPrompt('{{toString}}', {})).toThrow(/toString/);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(
      renderPrompt('{{ content }}|{{  nonce\t}}', { content: 'C', nonce: 'N' }),
    ).toBe('C|N');
  });

  it('leaves text without placeholders untouched', () => {
    expect(renderPrompt('{ {content} } {{}}', {})).toBe('{ {content} } {{}}');
  });
});

describe('listPlaceholders', () => {
  it('lists distinct names in order of first use', () => {
    expect(listPlaceholders('{{b}} {{ a }} {{b}}')).toEqual(['b', 'a']);
  });

  it('returns an empty list when there are none', () => {
    expect(listPlaceholders('plain')).toEqual([]);
  });
});
