import { ConfigService } from '@nestjs/config';
import { suggestionGeneratorFactory } from './ai.module';
import { AnthropicSuggestionGenerator } from './infrastructure/ai/anthropic-suggestion-generator';
import { AnthropicClientProvider } from './infrastructure/ai/anthropic.client';
import { NullSuggestionGenerator } from './infrastructure/ai/null-suggestion-generator';

describe('suggestionGeneratorFactory', () => {
  it('returns AnthropicSuggestionGenerator when ANTHROPIC_API_KEY is set', () => {
    const config = { get: () => 'sk-test-key' } as unknown as ConfigService;
    const clientProvider = {} as AnthropicClientProvider;

    const generator = suggestionGeneratorFactory(config, clientProvider);

    expect(generator).toBeInstanceOf(AnthropicSuggestionGenerator);
  });

  it('returns NullSuggestionGenerator when ANTHROPIC_API_KEY is unset', () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    const clientProvider = {} as AnthropicClientProvider;

    const generator = suggestionGeneratorFactory(config, clientProvider);

    expect(generator).toBeInstanceOf(NullSuggestionGenerator);
  });
});
