import { FakeAiQuota } from '../../application/ai/testing-fakes';
import { AiQuotaExceededError } from '../../domain/ai/ai-quota.errors';
import {
  LlmCompletion,
  LlmCompletionRequest,
  LlmGateway,
} from '../../domain/ai/llm-gateway.port';
import { SuggestionGenerationTruncatedError } from '../../domain/ai/suggestion-generation.errors';
import { PlanningOutputInvalidError } from '../../domain/context/planning-errors';
import { GatewayLlmPlanner } from './gateway-llm-planner';

function makeGateway(complete: jest.Mock, available = true): LlmGateway {
  return {
    isAvailable: () => available,
    modelIdentity: () => '["some/model"]',
    complete,
  };
}

const completion = (json: unknown): LlmCompletion => ({
  json,
  model: 'some/model',
  finishReason: 'stop',
});

const base = { userId: 'user-1', system: 'SYS', user: 'USER' };

describe('GatewayLlmPlanner', () => {
  it('maps the gateway JSON to a PlanningResult', async () => {
    const complete = jest.fn().mockResolvedValue(
      completion({
        suggestions: ['Do X'],
        outline: null,
        sources: ['notion'],
      }),
    );
    const planner = new GatewayLlmPlanner(
      makeGateway(complete),
      new FakeAiQuota(),
    );

    const result = await planner.plan({
      userId: 'user-1',
      prompt: 'Plan my chapter',
      context: { notion: { pages: [] } },
      system: 'SYS',
      user: 'USER',
    });

    expect(result).toEqual({
      suggestions: ['Do X'],
      outline: null,
      sources: ['notion'],
      model: 'some/model',
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'SYS', user: 'USER' }),
    );
  });

  it('defaults a missing outline to null', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(completion({ suggestions: [], sources: [] }));
    const planner = new GatewayLlmPlanner(
      makeGateway(complete),
      new FakeAiQuota(),
    );

    await expect(
      planner.plan({ prompt: 'x', context: {}, ...base }),
    ).resolves.toEqual({
      suggestions: [],
      outline: null,
      sources: [],
      model: 'some/model',
    });
  });

  it('throws when the gateway is unavailable', async () => {
    const planner = new GatewayLlmPlanner(
      makeGateway(jest.fn(), false),
      new FakeAiQuota(),
    );

    await expect(
      planner.plan({ prompt: 'x', context: {}, ...base }),
    ).rejects.toThrow('OPENROUTER_API_KEY');
  });

  it('throws when the JSON does not match the expected schema', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(completion({ wrong_key: 'oops' }));
    const planner = new GatewayLlmPlanner(
      makeGateway(complete),
      new FakeAiQuota(),
    );

    await expect(
      planner.plan({ prompt: 'x', context: {}, ...base }),
    ).rejects.toThrow(PlanningOutputInvalidError);
  });

  it('propagates gateway errors for ProcessPlanningJobUseCase to record as failed', async () => {
    const complete = jest
      .fn()
      .mockRejectedValue(new SuggestionGenerationTruncatedError());
    const planner = new GatewayLlmPlanner(
      makeGateway(complete),
      new FakeAiQuota(),
    );

    await expect(
      planner.plan({ prompt: 'x', context: {}, ...base }),
    ).rejects.toThrow(SuggestionGenerationTruncatedError);
  });

  it('reserves quota for the job owner on each provider attempt, not for the plan call itself', async () => {
    const quota = new FakeAiQuota();
    const complete = jest.fn((request: LlmCompletionRequest) =>
      request
        .beforeAttempt()
        .then(() =>
          completion({ suggestions: [], outline: null, sources: [] }),
        ),
    );
    const planner = new GatewayLlmPlanner(makeGateway(complete), quota);

    await planner.plan({ prompt: 'x', context: {}, ...base });

    expect(quota.reserved).toEqual(['user-1']);
  });

  it('lets a quota error from the hook through unchanged', async () => {
    const complete = jest.fn((request: LlmCompletionRequest) =>
      request.beforeAttempt().then(() => completion({})),
    );
    const planner = new GatewayLlmPlanner(
      makeGateway(complete),
      new FakeAiQuota(0),
    );

    await expect(
      planner.plan({ prompt: 'x', context: {}, ...base }),
    ).rejects.toBeInstanceOf(AiQuotaExceededError);
  });

  describe('output validation', () => {
    const valid = { suggestions: ['a'], outline: 'o', sources: ['s'] };
    const plan = (json: unknown) =>
      new GatewayLlmPlanner(
        makeGateway(jest.fn().mockResolvedValue(completion(json))),
        new FakeAiQuota(),
      ).plan({ prompt: 'x', context: {}, ...base });

    it.each([
      ['non-string suggestion', { ...valid, suggestions: ['a', 3] }],
      ['empty suggestion', { ...valid, suggestions: ['  '] }],
      ['object source', { ...valid, sources: [{ url: 'x' }] }],
      ['51 suggestions', { ...valid, suggestions: Array(51).fill('a') }],
      ['51 sources', { ...valid, sources: Array(51).fill('a') }],
      ['5001-char suggestion', { ...valid, suggestions: ['a'.repeat(5001)] }],
      ['5001-char source', { ...valid, sources: ['a'.repeat(5001)] }],
      ['numeric outline', { ...valid, outline: 5 }],
      ['100001-char outline', { ...valid, outline: 'a'.repeat(100_001) }],
    ])('rejects %s', async (_name, json) => {
      await expect(plan(json)).rejects.toThrow(PlanningOutputInvalidError);
    });

    it('accepts the limits exactly and a null or missing outline', async () => {
      await expect(
        plan({
          suggestions: Array(50).fill('a'.repeat(5000)),
          outline: 'o'.repeat(100_000),
          sources: Array(50).fill('s'),
        }),
      ).resolves.toBeDefined();
      await expect(
        plan({ suggestions: [], outline: null, sources: [] }),
      ).resolves.toMatchObject({ outline: null });
      await expect(
        plan({ suggestions: [], sources: [] }),
      ).resolves.toMatchObject({ outline: null });
    });

    it('uses a fixed message', async () => {
      await expect(
        plan({ ...valid, suggestions: ['SECRET-TEXT', 3] }),
      ).rejects.toThrow('The AI planner returned an invalid result');
    });
  });
});
