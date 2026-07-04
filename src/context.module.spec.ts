import { ConfigService } from '@nestjs/config';
import { ContextEnginePort } from './domain/context/context-engine.port';
import { ConnectorContextGatherer } from './infrastructure/context/connector-context-gatherer';
import { StubContextGatherer } from './infrastructure/context/stub-context-gatherer';
import { contextGathererFactory } from './context.module';

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
