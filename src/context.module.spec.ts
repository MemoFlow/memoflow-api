import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContextEnginePort } from './domain/context/context-engine.port';
import { AnthropicClientProvider } from './infrastructure/ai/anthropic.client';
import { ContextResultsConsumer } from './infrastructure/amqp/context-results.consumer';
import { RabbitContextRequestPublisher } from './infrastructure/amqp/rabbit-context-request.publisher';
import { RabbitMqConnectionProvider } from './infrastructure/amqp/rabbitmq-connection.provider';
import { AnthropicLlmPlanner } from './infrastructure/context/anthropic-llm-planner';
import { ConnectorContextGatherer } from './infrastructure/context/connector-context-gatherer';
import { StubContextGatherer } from './infrastructure/context/stub-context-gatherer';
import { StubLlmPlanner } from './infrastructure/context/stub-llm-planner';
import { BullMqGatherTimeoutScheduler } from './infrastructure/queue/context/bullmq-gather-timeout.scheduler';
import {
  contextGathererFactory,
  contextRequestPublisherFactory,
  contextResultsConsumerFactory,
  gatherTimeoutMsFactory,
  gatherTimeoutSchedulerFactory,
  llmPlannerFactory,
} from './context.module';

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

describe('gatherTimeoutMsFactory', () => {
  it('defaults to 120000 when CONTEXT_GATHER_TIMEOUT_MS is unset', () => {
    expect(gatherTimeoutMsFactory(makeConfig(undefined))).toBe(120_000);
  });

  it('uses the configured value when set', () => {
    const config = { get: () => 30_000 } as unknown as ConfigService;
    expect(gatherTimeoutMsFactory(config)).toBe(30_000);
  });
});

function makeConnectionProvider(): RabbitMqConnectionProvider {
  const channel = {
    waitForConnect: jest.fn().mockResolvedValue(undefined),
    publish: jest.fn().mockResolvedValue(true),
    consume: jest.fn().mockResolvedValue(undefined),
  };
  const connection = { createChannel: jest.fn().mockReturnValue(channel) };
  return {
    getConnection: () => connection,
  } as unknown as RabbitMqConnectionProvider;
}

describe('contextRequestPublisherFactory (RabbitMQ context-engine transport)', () => {
  it('returns undefined when RABBITMQ_URL is unset — legacy path stays the only one active', () => {
    const result = contextRequestPublisherFactory(
      makeConfig(undefined),
      makeConnectionProvider(),
    );
    expect(result).toBeUndefined();
  });

  it('returns a RabbitContextRequestPublisher when RABBITMQ_URL is set', () => {
    const result = contextRequestPublisherFactory(
      makeConfig('amqp://guest:guest@localhost:5672'),
      makeConnectionProvider(),
    );
    expect(result).toBeInstanceOf(RabbitContextRequestPublisher);
  });
});

describe('gatherTimeoutSchedulerFactory', () => {
  const queue = {} as unknown as Parameters<
    typeof gatherTimeoutSchedulerFactory
  >[1];

  it('returns undefined when RABBITMQ_URL is unset', () => {
    expect(
      gatherTimeoutSchedulerFactory(makeConfig(undefined), queue),
    ).toBeUndefined();
  });

  it('returns a BullMqGatherTimeoutScheduler when RABBITMQ_URL is set', () => {
    const result = gatherTimeoutSchedulerFactory(
      makeConfig('amqp://guest:guest@localhost:5672'),
      queue,
    );
    expect(result).toBeInstanceOf(BullMqGatherTimeoutScheduler);
  });
});

describe('contextResultsConsumerFactory', () => {
  const handleChunk = {} as Parameters<typeof contextResultsConsumerFactory>[2];
  const eventEmitter = new EventEmitter2();

  it('returns undefined when RABBITMQ_URL is unset', () => {
    const result = contextResultsConsumerFactory(
      makeConfig(undefined),
      makeConnectionProvider(),
      handleChunk,
      eventEmitter,
    );
    expect(result).toBeUndefined();
  });

  it('returns a ContextResultsConsumer when RABBITMQ_URL is set', () => {
    const result = contextResultsConsumerFactory(
      makeConfig('amqp://guest:guest@localhost:5672'),
      makeConnectionProvider(),
      handleChunk,
      eventEmitter,
    );
    expect(result).toBeInstanceOf(ContextResultsConsumer);
  });
});
