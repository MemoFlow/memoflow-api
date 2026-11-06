import { LlmCompletion, LlmGateway } from '../../domain/ai/llm-gateway.port';
import {
  SuggestionGenerationProviderError,
  SuggestionGenerationRefusedError,
  SuggestionGenerationTruncatedError,
  SuggestionGeneratorRateLimitedError,
  SuggestionGeneratorUnavailableError,
} from '../../domain/ai/suggestion-generation.errors';
import { GatewaySuggestionGenerator } from './gateway-suggestion-generator';

function makeGateway(complete: jest.Mock, available = true): LlmGateway {
  return { isAvailable: () => available, complete };
}

const completion = (json: unknown): LlmCompletion => ({
  json,
  model: 'some/model',
  finishReason: 'stop',
});

const input = {
  promptTemplate: 'Improve this: Hello world',
  originalText: 'Hello world',
  featureType: 'suggestion',
};

describe('GatewaySuggestionGenerator', () => {
  it('maps the gateway JSON to { suggestedText } and sends the prompt as user message', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(completion({ suggested_text: 'Better text.' }));
    const generator = new GatewaySuggestionGenerator(makeGateway(complete));

    await expect(generator.generate(input)).resolves.toEqual({
      suggestedText: 'Better text.',
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'Improve this: Hello world',
        jsonSchema: expect.objectContaining({ name: 'suggestion' }),
      }),
    );
  });

  it('reports availability from the gateway', () => {
    expect(
      new GatewaySuggestionGenerator(
        makeGateway(jest.fn(), false),
      ).isAvailable(),
    ).toBe(false);
    expect(
      new GatewaySuggestionGenerator(
        makeGateway(jest.fn(), true),
      ).isAvailable(),
    ).toBe(true);
  });

  it.each([
    new SuggestionGeneratorUnavailableError(),
    new SuggestionGenerationRefusedError(),
    new SuggestionGenerationTruncatedError(),
    new SuggestionGeneratorRateLimitedError('slow', 30),
    new SuggestionGenerationProviderError(),
  ])('propagates typed gateway error %p unchanged', async (err) => {
    const complete = jest.fn().mockRejectedValue(err);
    const generator = new GatewaySuggestionGenerator(makeGateway(complete));

    await expect(generator.generate(input)).rejects.toBe(err);
  });

  it('throws SuggestionGenerationProviderError when the JSON does not match the schema', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(completion({ wrong_key: 'oops' }));
    const generator = new GatewaySuggestionGenerator(makeGateway(complete));

    await expect(generator.generate(input)).rejects.toThrow(
      SuggestionGenerationProviderError,
    );
  });

  it('throws SuggestionGenerationProviderError when the JSON is null', async () => {
    const complete = jest.fn().mockResolvedValue(completion(null));
    const generator = new GatewaySuggestionGenerator(makeGateway(complete));

    await expect(generator.generate(input)).rejects.toThrow(
      SuggestionGenerationProviderError,
    );
  });
});
