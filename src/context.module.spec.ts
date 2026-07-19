import { ConfigService } from '@nestjs/config';
import { ContextEnginePort } from './domain/context/context-engine.port';
import { AnthropicClientProvider } from './infrastructure/ai/anthropic.client';
import { AnthropicLlmPlanner } from './infrastructure/context/anthropic-llm-planner';
import { ConnectorContextGatherer } from './infrastructure/context/connector-context-gatherer';
import { StubContextGatherer } from './infrastructure/context/stub-context-gatherer';
import { StubLlmPlanner } from './infrastructure/context/stub-llm-planner';
import { contextGathererFactory, llmPlannerFactory } from './context.module';

function makeConfig(url: string | undefined): ConfigService {
  return {
    get: () => url,
  } as unknown as ConfigService;
}

describe('contextGathererFactory', () => {
  const engine = {} as ContextEnginePort;

  it('returns StubContextGatherer when CONTEXT_ENGINE_URL is unset', () => {
    const gatherer = contextGathererFactory(makeConfig(undefined), engine);

    expect(gatherer).toBeInstanceOf(StubContextGatherer);
  });

  it('returns StubContextGatherer when CONTEXT_ENGINE_URL is an empty string', () => {
    const gatherer = contextGathererFactory(makeConfig(''), engine);

    expect(gatherer).toBeInstanceOf(StubContextGatherer);
  });

  it('returns ConnectorContextGatherer when CONTEXT_ENGINE_URL is set', () => {
    const gatherer = contextGathererFactory(
      makeConfig('https://context-engine.example.com'),
      engine,
    );

    expect(gatherer).toBeInstanceOf(ConnectorContextGatherer);
  });
});

describe('llmPlannerFactory', () => {
  const clientProvider = {} as AnthropicClientProvider;

  it('returns StubLlmPlanner when ANTHROPIC_API_KEY is unset', () => {
    const planner = llmPlannerFactory(makeConfig(undefined), clientProvider);

    expect(planner).toBeInstanceOf(StubLlmPlanner);
  });

  it('returns AnthropicLlmPlanner when ANTHROPIC_API_KEY is set', () => {
    const planner = llmPlannerFactory(
      makeConfig('sk-test-key'),
      clientProvider,
    );

    expect(planner).toBeInstanceOf(AnthropicLlmPlanner);
  });
});
