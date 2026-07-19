import Anthropic from '@anthropic-ai/sdk';
import {
  SuggestionGenerationProviderError,
  SuggestionGenerationRefusedError,
  SuggestionGenerationTruncatedError,
  SuggestionGeneratorRateLimitedError,
  SuggestionGeneratorUnavailableError,
} from '../../domain/ai/suggestion-generation.errors';
import { AnthropicClientProvider } from './anthropic.client';
import { AnthropicSuggestionGenerator } from './anthropic-suggestion-generator';

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
        text: '{"suggested_text":"Better text."}',
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

describe('AnthropicSuggestionGenerator', () => {
  it('parses a successful JSON response into { suggestedText }', async () => {
    const create = jest.fn().mockResolvedValue(textMessage());
    const generator = new AnthropicSuggestionGenerator(
      makeFakeClientProvider(create),
    );

    const result = await generator.generate({
      promptTemplate: 'Improve this: Hello world',
      originalText: 'Hello world',
      featureType: 'suggestion',
    });

    expect(result).toEqual({ suggestedText: 'Better text.' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'Improve this: Hello world' }],
        output_config: expect.objectContaining({
          format: expect.objectContaining({ type: 'json_schema' }),
        }),
      }),
    );
  });

  it('is unavailable when the client provider has no API key configured', () => {
    const generator = new AnthropicSuggestionGenerator(
      makeFakeClientProvider(jest.fn(), false),
    );
    expect(generator.isAvailable()).toBe(false);
  });

  it('throws SuggestionGeneratorUnavailableError when called without a client', async () => {
    const generator = new AnthropicSuggestionGenerator(
      makeFakeClientProvider(jest.fn(), false),
    );

    await expect(
      generator.generate({
        promptTemplate: 'x',
        originalText: 'x',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(SuggestionGeneratorUnavailableError);
  });

  it('throws SuggestionGenerationRefusedError on stop_reason "refusal"', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(textMessage({ stop_reason: 'refusal' }));
    const generator = new AnthropicSuggestionGenerator(
      makeFakeClientProvider(create),
    );

    await expect(
      generator.generate({
        promptTemplate: 'x',
        originalText: 'x',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(SuggestionGenerationRefusedError);
  });

  it('throws SuggestionGenerationTruncatedError on stop_reason "max_tokens"', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(textMessage({ stop_reason: 'max_tokens' }));
    const generator = new AnthropicSuggestionGenerator(
      makeFakeClientProvider(create),
    );

    await expect(
      generator.generate({
        promptTemplate: 'x',
        originalText: 'x',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(SuggestionGenerationTruncatedError);
  });

  it('throws SuggestionGenerationProviderError when the response body is not valid JSON', async () => {
    const create = jest.fn().mockResolvedValue(
      textMessage({
        content: [{ type: 'text', text: 'not json', citations: [] }] as never,
      }),
    );
    const generator = new AnthropicSuggestionGenerator(
      makeFakeClientProvider(create),
    );

    await expect(
      generator.generate({
        promptTemplate: 'x',
        originalText: 'x',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(SuggestionGenerationProviderError);
  });

  it('throws SuggestionGenerationProviderError when the JSON does not match the expected schema', async () => {
    const create = jest.fn().mockResolvedValue(
      textMessage({
        content: [
          { type: 'text', text: '{"wrong_key":"oops"}', citations: [] },
        ] as never,
      }),
    );
    const generator = new AnthropicSuggestionGenerator(
      makeFakeClientProvider(create),
    );

    await expect(
      generator.generate({
        promptTemplate: 'x',
        originalText: 'x',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(SuggestionGenerationProviderError);
  });

  it('maps Anthropic.RateLimitError to SuggestionGeneratorRateLimitedError with a retry hint', async () => {
    const rateLimitError = new Anthropic.RateLimitError(
      429,
      { error: { type: 'rate_limit_error', message: 'slow down' } },
      'slow down',
      new Headers({ 'retry-after': '30' }),
    );
    const create = jest.fn().mockRejectedValue(rateLimitError);
    const generator = new AnthropicSuggestionGenerator(
      makeFakeClientProvider(create),
    );

    await expect(
      generator.generate({
        promptTemplate: 'x',
        originalText: 'x',
        featureType: 'suggestion',
      }),
    ).rejects.toMatchObject({
      name: 'SuggestionGeneratorRateLimitedError',
      retryAfterSeconds: 30,
    } satisfies Partial<SuggestionGeneratorRateLimitedError>);
  });

  it('maps other Anthropic.APIError instances to SuggestionGenerationProviderError', async () => {
    const serverError = new Anthropic.InternalServerError(
      500,
      { error: { type: 'api_error', message: 'oops' } },
      'oops',
      new Headers(),
    );
    const create = jest.fn().mockRejectedValue(serverError);
    const generator = new AnthropicSuggestionGenerator(
      makeFakeClientProvider(create),
    );

    await expect(
      generator.generate({
        promptTemplate: 'x',
        originalText: 'x',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(SuggestionGenerationProviderError);
  });

  it('maps unexpected non-Anthropic errors to SuggestionGenerationProviderError', async () => {
    const create = jest.fn().mockRejectedValue(new Error('network exploded'));
    const generator = new AnthropicSuggestionGenerator(
      makeFakeClientProvider(create),
    );

    await expect(
      generator.generate({
        promptTemplate: 'x',
        originalText: 'x',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(SuggestionGenerationProviderError);
  });
});
