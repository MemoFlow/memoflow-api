import { LlmCompletion, LlmGateway } from '../../domain/ai/llm-gateway.port';
import { SuggestionGenerationTruncatedError } from '../../domain/ai/suggestion-generation.errors';
import { GatewayLlmPlanner } from './gateway-llm-planner';

function makeGateway(complete: jest.Mock, available = true): LlmGateway {
  return { isAvailable: () => available, complete };
}

const completion = (json: unknown): LlmCompletion => ({
  json,
  model: 'some/model',
  finishReason: 'stop',
});

const base = { system: 'SYS', user: 'USER' };

describe('GatewayLlmPlanner', () => {
  it('maps the gateway JSON to a PlanningResult', async () => {
    const complete = jest.fn().mockResolvedValue(
      completion({
        suggestions: ['Do X'],
        outline: null,
        sources: ['notion'],
      }),
    );
    const planner = new GatewayLlmPlanner(makeGateway(complete));

    const result = await planner.plan({
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
    const planner = new GatewayLlmPlanner(makeGateway(complete));

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
    const planner = new GatewayLlmPlanner(makeGateway(jest.fn(), false));

    await expect(
      planner.plan({ prompt: 'x', context: {}, ...base }),
    ).rejects.toThrow('OPENROUTER_API_KEY');
  });

  it('throws when the JSON does not match the expected schema', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(completion({ wrong_key: 'oops' }));
    const planner = new GatewayLlmPlanner(makeGateway(complete));

    await expect(
      planner.plan({ prompt: 'x', context: {}, ...base }),
    ).rejects.toThrow('expected schema');
  });

  it('propagates gateway errors for ProcessPlanningJobUseCase to record as failed', async () => {
    const complete = jest
      .fn()
      .mockRejectedValue(new SuggestionGenerationTruncatedError());
    const planner = new GatewayLlmPlanner(makeGateway(complete));

    await expect(
      planner.plan({ prompt: 'x', context: {}, ...base }),
    ).rejects.toThrow(SuggestionGenerationTruncatedError);
  });
});
