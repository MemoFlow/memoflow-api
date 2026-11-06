import {
  classifyForbidden,
  countersRose,
  findStructuredFreeModels,
  invalidCitationIds,
  isInsecureRemoteHttp,
  isLikelyProduction,
  planningJobProblems,
  summarizePlanningJob,
  summarizeSteps,
} from './ai-smoke-checks';

describe('ai-smoke-checks', () => {
  describe('isLikelyProduction', () => {
    it.each([
      'api.memoflow.com',
      'memoflow-prod.onrender.com',
      'dev-prod.example.com',
      'example.com',
    ])('refuses %s', (host) => {
      expect(isLikelyProduction(host)).toBe(true);
    });

    it.each([
      'localhost',
      '127.0.0.1',
      'memoflow-api-dev.onrender.com',
      'dev.example.com',
      'api.staging.example.com',
    ])('allows %s', (host) => {
      expect(isLikelyProduction(host)).toBe(false);
    });
  });

  it('summarizes steps and only fails the exit code on FAIL', () => {
    const ok = summarizeSteps([
      { name: 'a', status: 'PASS' },
      { name: 'b', status: 'SKIP' },
    ]);
    expect(ok.exitCode).toBe(0);
    expect(ok.line).toBe('Summary: 1 passed, 0 failed, 1 skipped');
    expect(summarizeSteps([{ name: 'a', status: 'FAIL' }]).exitCode).toBe(1);
  });

  it('finds free models with structured output support', () => {
    const models = [
      {
        id: 'a/free:free',
        pricing: { prompt: '0', completion: '0' },
        supported_parameters: ['response_format'],
      },
      {
        id: 'b/paid',
        pricing: { prompt: '0.1', completion: '0.1' },
        supported_parameters: ['response_format'],
      },
      {
        id: 'c/free',
        pricing: { prompt: '0', completion: '0' },
        supported_parameters: ['structured_outputs'],
      },
      {
        id: 'd/free:free',
        supported_parameters: ['temperature'],
      },
    ];
    expect(findStructuredFreeModels(models)).toEqual({
      count: 2,
      ids: ['a/free:free', 'c/free'],
    });
    expect(findStructuredFreeModels(models, 1).ids).toHaveLength(1);
  });

  it('flags citation ids that are not S plus a number', () => {
    expect(invalidCitationIds(['S1', 'S12', 's1', 'S', 'S1a', '1'])).toEqual([
      's1',
      'S',
      'S1a',
      '1',
    ]);
  });

  it('summarizes a planning job without any text', () => {
    const summary = summarizePlanningJob({
      result: {
        suggestions: ['x', 'y'],
        sources: [{ id: 'S1' }, { id: 'bad' }, {}],
      },
      context_used: { retrieval: { matched: 3, used: 2, sources: [] } },
    });
    expect(summary).toEqual({
      suggestionCount: 2,
      sourceIds: ['S1', 'bad', '<missing>'],
      invalidSourceIds: ['bad', '<missing>'],
      retrieval: { matched: 3, used: 2 },
      retrievalFailed: null,
    });
    expect(summarizePlanningJob({}).suggestionCount).toBe(0);
  });

  it('detects counters rising', () => {
    expect(countersRose({ user: 0, global: 1 }, { user: 2, global: 3 })).toBe(
      true,
    );
    expect(countersRose({ user: 0, global: 1 }, { user: 2, global: 1 })).toBe(
      false,
    );
  });

  describe('planningJobProblems', () => {
    const good = summarizePlanningJob({
      result: {},
      context_used: { retrieval: { matched: 2, used: 1, failed: false } },
    });

    it('accepts a real model with successful retrieval', () => {
      expect(planningJobProblems(good, 'm/x')).toEqual([]);
    });

    it('flags a null model', () => {
      expect(planningJobProblems(good, null)).toHaveLength(1);
    });

    it('flags failed, missing and empty retrieval', () => {
      const failed = summarizePlanningJob({
        context_used: { retrieval: { matched: 2, used: 1, failed: true } },
      });
      expect(planningJobProblems(failed, 'm')).toEqual([
        'retrieval.failed is true',
      ]);
      expect(planningJobProblems(summarizePlanningJob({}), 'm')).toHaveLength(
        3,
      );
      const none = summarizePlanningJob({
        context_used: { retrieval: { matched: 0, used: 0, failed: false } },
      });
      expect(planningJobProblems(none, 'm')).toHaveLength(2);
    });
  });

  it('refuses plain http except to loopback', () => {
    const u = (s: string) => new URL(s);
    expect(isInsecureRemoteHttp(u('http://example.dev.test'))).toBe(true);
    expect(isInsecureRemoteHttp(u('https://example.dev.test'))).toBe(false);
    expect(isInsecureRemoteHttp(u('http://localhost:3000'))).toBe(false);
    expect(isInsecureRemoteHttp(u('http://127.0.0.1:3000'))).toBe(false);
    expect(isInsecureRemoteHttp(u('http://[::1]:3000'))).toBe(false);
  });

  it('classifies 403 bodies', () => {
    expect(classifyForbidden({ error: 'AI_CONSENT_REQUIRED' })).toBe('consent');
    expect(
      classifyForbidden({ message: 'Email not verified', error: 'Forbidden' }),
    ).toBe('email');
    expect(classifyForbidden(null)).toBe('other');
  });
});
