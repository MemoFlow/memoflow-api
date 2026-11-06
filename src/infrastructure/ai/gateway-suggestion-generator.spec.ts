import { FakeAiQuota } from '../../application/ai/testing-fakes';
import { AiQuotaExceededError } from '../../domain/ai/ai-quota.errors';
import {
  LlmCompletion,
  LlmCompletionRequest,
  LlmGateway,
} from '../../domain/ai/llm-gateway.port';
import {
  SuggestionGenerationProviderError,
  SuggestionGenerationRefusedError,
  SuggestionGenerationTruncatedError,
  SuggestionGeneratorRateLimitedError,
  SuggestionGeneratorUnavailableError,
} from '../../domain/ai/suggestion-generation.errors';
import { GatewaySuggestionGenerator } from './gateway-suggestion-generator';

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

const input = {
  system: 'You are a writing assistant.',
  user: 'Improve this: Hello world',
  featureType: 'suggestion',
  userId: 'user-1',
};

describe('GatewaySuggestionGenerator', () => {
  it('maps the gateway JSON to { suggestedText, model } and sends system and user as given', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(completion({ suggested_text: 'Better text.' }));
    const generator = new GatewaySuggestionGenerator(
      makeGateway(complete),
      new FakeAiQuota(),
    );

    await expect(generator.generate(input)).resolves.toEqual({
      suggestedText: 'Better text.',
      model: 'some/model',
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a writing assistant.',
        user: 'Improve this: Hello world',
        jsonSchema: expect.objectContaining({ name: 'suggestion' }),
      }),
    );
  });

  it('reports availability from the gateway', () => {
    expect(
      new GatewaySuggestionGenerator(
        makeGateway(jest.fn(), false),
        new FakeAiQuota(),
      ).isAvailable(),
    ).toBe(false);
    expect(
      new GatewaySuggestionGenerator(
        makeGateway(jest.fn(), true),
        new FakeAiQuota(),
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
    const generator = new GatewaySuggestionGenerator(
      makeGateway(complete),
      new FakeAiQuota(),
    );

    await expect(generator.generate(input)).rejects.toBe(err);
  });

  it('throws SuggestionGenerationProviderError when the JSON does not match the schema', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(completion({ wrong_key: 'oops' }));
    const generator = new GatewaySuggestionGenerator(
      makeGateway(complete),
      new FakeAiQuota(),
    );

    await expect(generator.generate(input)).rejects.toThrow(
      SuggestionGenerationProviderError,
    );
  });

  it('throws SuggestionGenerationProviderError when the JSON is null', async () => {
    const complete = jest.fn().mockResolvedValue(completion(null));
    const generator = new GatewaySuggestionGenerator(
      makeGateway(complete),
      new FakeAiQuota(),
    );

    await expect(generator.generate(input)).rejects.toThrow(
      SuggestionGenerationProviderError,
    );
  });

  it('passes a beforeAttempt hook that reserves quota for the user', async () => {
    const quota = new FakeAiQuota();
    const complete = jest
      .fn()
      .mockResolvedValue(completion({ suggested_text: 'ok' }));
    const generator = new GatewaySuggestionGenerator(
      makeGateway(complete),
      quota,
    );

    await generator.generate(input);
    expect(quota.reserved).toEqual([]);

    const request = (complete.mock.calls[0] as [LlmCompletionRequest])[0];
    await request.beforeAttempt();
    await request.beforeAttempt();
    expect(quota.reserved).toEqual(['user-1', 'user-1']);
  });

  it('surfaces a quota error thrown by the hook unchanged', async () => {
    const quota = new FakeAiQuota(0);
    const complete = jest.fn((request: LlmCompletionRequest) =>
      request.beforeAttempt().then(() => completion({ suggested_text: 'x' })),
    );
    const generator = new GatewaySuggestionGenerator(
      makeGateway(complete),
      quota,
    );

    await expect(generator.generate(input)).rejects.toBeInstanceOf(
      AiQuotaExceededError,
    );
  });

  it('scopes the cache by the gateway model identity', () => {
    const gateway: LlmGateway = {
      ...makeGateway(jest.fn()),
      modelIdentity: () => '["a","b"]',
    };
    expect(
      new GatewaySuggestionGenerator(gateway, new FakeAiQuota()).cacheScope(),
    ).toBe('["a","b"]');
  });
});
