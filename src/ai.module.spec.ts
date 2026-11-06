import { ConfigService } from '@nestjs/config';
import { suggestionGeneratorFactory } from './ai.module';
import { LlmGateway } from './domain/ai/llm-gateway.port';
import { GatewaySuggestionGenerator } from './infrastructure/ai/gateway-suggestion-generator';
import { NullSuggestionGenerator } from './infrastructure/ai/null-suggestion-generator';

describe('suggestionGeneratorFactory', () => {
  const gateway = {} as LlmGateway;

  it('returns GatewaySuggestionGenerator when OPENROUTER_API_KEY is set', () => {
    const config = { get: () => 'sk-test-key' } as unknown as ConfigService;

    expect(suggestionGeneratorFactory(config, gateway)).toBeInstanceOf(
      GatewaySuggestionGenerator,
    );
  });

  it('returns NullSuggestionGenerator when OPENROUTER_API_KEY is unset', () => {
    const config = { get: () => undefined } as unknown as ConfigService;

    expect(suggestionGeneratorFactory(config, gateway)).toBeInstanceOf(
      NullSuggestionGenerator,
    );
  });
});
