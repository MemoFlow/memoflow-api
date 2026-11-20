import {
  AiQuotaExceededError,
  aiQuotaMessage,
  formatResetDuration,
} from './ai-quota.errors';

describe('formatResetDuration', () => {
  it.each([
    [1, '1 min'],
    [45 * 60, '45 min'],
    [45 * 60 + 1, '46 min'],
    [3600, '1 h'],
    [2 * 3600 + 5 * 60, '2 h 5 min'],
    [5 * 3600 + 59 * 60, '5 h 59 min'],
  ])('%i seconds -> %s', (seconds, text) => {
    expect(formatResetDuration(seconds)).toBe(text);
  });
});

describe('AiQuotaExceededError', () => {
  it('formats the user message with the limit and time to reset', () => {
    expect(aiQuotaMessage('user', 10, 3 * 3600 + 20 * 60)).toBe(
      "You've used all 10 AI requests for today. Your quota resets at 00:00 UTC (in 3 h 20 min).",
    );
  });

  it('formats the global message without the limit', () => {
    expect(aiQuotaMessage('global', 40, 30 * 60)).toBe(
      "MemoFlow's AI capacity for today has been reached. It resets at 00:00 UTC (in 30 min).",
    );
  });

  it('carries scope, limit, resetsAt and the client code', () => {
    const now = new Date('2026-11-20T22:00:00.000Z');
    const user = new AiQuotaExceededError('user', 10, 7200, now);
    expect(user).toMatchObject({
      scope: 'user',
      limit: 10,
      code: 'AI_QUOTA_EXCEEDED',
    });
    expect(user.resetsAt.toISOString()).toBe('2026-11-21T00:00:00.000Z');
    expect(new AiQuotaExceededError('global', 40, 60).code).toBe(
      'AI_GLOBAL_QUOTA_EXCEEDED',
    );
  });
});
