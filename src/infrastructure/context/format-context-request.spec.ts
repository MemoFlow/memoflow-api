import { formatContextRequest } from './format-context-request';

describe('formatContextRequest', () => {
  it('trims and collapses whitespace in the prompt', () => {
    const result = formatContextRequest({
      userId: 'user-1',
      connectors: ['trello'],
      prompt: '  Plan   my    chapter  \n\n',
    });

    expect(result.prompt).toBe('Plan my chapter');
  });

  it('dedupes requested connectors while preserving order', () => {
    const result = formatContextRequest({
      userId: 'user-1',
      connectors: ['trello', 'notion', 'trello'],
      prompt: 'hi',
    });

    expect(result.connectors).toEqual(['trello', 'notion']);
  });

  it('leaves userId untouched', () => {
    const result = formatContextRequest({
      userId: 'user-1',
      connectors: [],
      prompt: 'hi',
    });

    expect(result.userId).toBe('user-1');
  });
});
