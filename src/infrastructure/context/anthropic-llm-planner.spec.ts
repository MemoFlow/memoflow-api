import Anthropic from '@anthropic-ai/sdk';
import { AnthropicClientProvider } from '../ai/anthropic.client';
import { AnthropicLlmPlanner } from './anthropic-llm-planner';

function makeFakeClientProvider(
  create: jest.Mock,
  available = true,
): AnthropicClientProvider {
  return {
    isAvailable: () => available,
    getClient: () => ({ messages: { create } }) as unknown as Anthropic,
    getModel: () => 'claude-sonnet-5',
    getMaxTokens: () => 4096,
  } as unknown as AnthropicClientProvider;
}

function textMessage(
  overrides: Partial<Anthropic.Message> = {},
): Anthropic.Message {
  return {
    id: 'msg_1',
    container: null,
    content: [
      {
        type: 'text',
        text: '{"suggestions":["Do X"],"outline":null,"sources":["notion"]}',
        citations: [],
      },
    ] as never,
    model: 'claude-sonnet-5',
    role: 'assistant',
    stop_details: null,
    stop_reason: 'end_turn',
    stop_sequence: null,
    type: 'message',
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
      cache_creation: null,
    } as never,
    ...overrides,
  };
}

describe('AnthropicLlmPlanner', () => {
  it('parses a successful JSON response into a PlanningResult', async () => {
    const create = jest.fn().mockResolvedValue(textMessage());
    const planner = new AnthropicLlmPlanner(makeFakeClientProvider(create));

    const result = await planner.plan({
      prompt: 'Plan my chapter',
      context: { notion: { pages: [] } },
    });

    expect(result).toEqual({
      suggestions: ['Do X'],
      outline: null,
      sources: ['notion'],
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        output_config: expect.objectContaining({
          format: expect.objectContaining({ type: 'json_schema' }),
        }),
      }),
    );
  });

  it('throws when the client provider has no API key configured', async () => {
    const planner = new AnthropicLlmPlanner(
      makeFakeClientProvider(jest.fn(), false),
    );

    await expect(planner.plan({ prompt: 'x', context: {} })).rejects.toThrow(
      'ANTHROPIC_API_KEY',
    );
  });

  it('throws on stop_reason "refusal"', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(textMessage({ stop_reason: 'refusal' }));
    const planner = new AnthropicLlmPlanner(makeFakeClientProvider(create));

    await expect(planner.plan({ prompt: 'x', context: {} })).rejects.toThrow(
      'refused',
    );
  });

  it('throws on stop_reason "max_tokens"', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(textMessage({ stop_reason: 'max_tokens' }));
    const planner = new AnthropicLlmPlanner(makeFakeClientProvider(create));

    await expect(planner.plan({ prompt: 'x', context: {} })).rejects.toThrow(
      'truncated',
    );
  });

  it('throws when the response body is not valid JSON', async () => {
    const create = jest.fn().mockResolvedValue(
      textMessage({
        content: [{ type: 'text', text: 'not json', citations: [] }] as never,
      }),
    );
    const planner = new AnthropicLlmPlanner(makeFakeClientProvider(create));

    await expect(planner.plan({ prompt: 'x', context: {} })).rejects.toThrow(
      'not valid JSON',
    );
  });

  it('throws when the JSON does not match the expected schema', async () => {
    const create = jest.fn().mockResolvedValue(
      textMessage({
        content: [
          { type: 'text', text: '{"wrong_key":"oops"}', citations: [] },
        ] as never,
      }),
    );
    const planner = new AnthropicLlmPlanner(makeFakeClientProvider(create));

    await expect(planner.plan({ prompt: 'x', context: {} })).rejects.toThrow(
      'expected schema',
    );
  });

  it('propagates SDK errors (e.g. rate limiting) unmapped, for ProcessPlanningJobUseCase to record as failed', async () => {
    const rateLimitError = new Anthropic.RateLimitError(
      429,
      { error: { type: 'rate_limit_error', message: 'slow down' } },
      'slow down',
      new Headers({ 'retry-after': '30' }),
    );
    const create = jest.fn().mockRejectedValue(rateLimitError);
    const planner = new AnthropicLlmPlanner(makeFakeClientProvider(create));

    await expect(planner.plan({ prompt: 'x', context: {} })).rejects.toThrow(
      Anthropic.RateLimitError,
    );
  });
});
