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
    });

    expect(result).toEqual({
      suggestions: ['Do X'],
      outline: null,
      sources: ['notion'],
    });
    const arg = complete.mock.calls[0][0] as { user: string };
    expect(arg.user).toContain('Plan my chapter');
    expect(arg.user).toContain('"notion"');
  });

  it('defaults a missing outline to null', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(completion({ suggestions: [], sources: [] }));
    const planner = new GatewayLlmPlanner(makeGateway(complete));

    await expect(planner.plan({ prompt: 'x', context: {} })).resolves.toEqual({
      suggestions: [],
      outline: null,
      sources: [],
    });
  });

  it('throws when the gateway is unavailable', async () => {
    const planner = new GatewayLlmPlanner(makeGateway(jest.fn(), false));

    await expect(planner.plan({ prompt: 'x', context: {} })).rejects.toThrow(
      'OPENROUTER_API_KEY',
    );
  });

  it('throws when the JSON does not match the expected schema', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(completion({ wrong_key: 'oops' }));
    const planner = new GatewayLlmPlanner(makeGateway(complete));

    await expect(planner.plan({ prompt: 'x', context: {} })).rejects.toThrow(
      'expected schema',
    );
  });

  it('propagates gateway errors for ProcessPlanningJobUseCase to record as failed', async () => {
    const complete = jest
      .fn()
      .mockRejectedValue(new SuggestionGenerationTruncatedError());
    const planner = new GatewayLlmPlanner(makeGateway(complete));

    await expect(planner.plan({ prompt: 'x', context: {} })).rejects.toThrow(
      SuggestionGenerationTruncatedError,
    );
  });
});
