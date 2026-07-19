import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { RabbitContextRequestPublisher } from './rabbit-context-request.publisher';
import { RabbitMqConnectionProvider } from './rabbitmq-connection.provider';
import {
  CONTEXT_EXCHANGE,
  CTX_GATHER_REQUEST_ROUTING_KEY,
} from './context-topology';

function makeConnectionProvider(channel: {
  waitForConnect: jest.Mock;
  publish: jest.Mock;
}): RabbitMqConnectionProvider {
  const createChannel = jest.fn().mockReturnValue(channel);
  const connection = { createChannel };
  return {
    getConnection: () => connection,
  } as unknown as RabbitMqConnectionProvider;
}

describe('RabbitContextRequestPublisher', () => {
  it('publishes to the context exchange with routing key ctx.gather.request', async () => {
    const channel = {
      waitForConnect: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(true),
    };
    const publisher = new RabbitContextRequestPublisher(
      makeConnectionProvider(channel),
    );
    await publisher.onModuleInit();

    await publisher.publishGatherRequest({
      jobId: '665f1a2b3c4d5e6f7a8b9c0d',
      userId: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
      prompt: 'Draft an outline for chapter 3',
      connectors: [
        {
          provider: ConnectorProvider.Trello,
          mcpUrl: null,
          composioAccountId: 'ca_abc123',
        },
      ],
      requestedAt: new Date('2026-07-04T12:00:00.000Z'),
    });

    expect(channel.publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, content, options] = channel.publish.mock
      .calls[0] as [string, string, Buffer, Record<string, unknown>];

    expect(exchange).toBe(CONTEXT_EXCHANGE);
    expect(routingKey).toBe(CTX_GATHER_REQUEST_ROUTING_KEY);
    expect(JSON.parse(content.toString('utf-8'))).toEqual({
      schema_version: 1,
      job_id: '665f1a2b3c4d5e6f7a8b9c0d',
      user_id: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
      prompt: 'Draft an outline for chapter 3',
      connectors: [
        { provider: 'trello', mcp_url: null, composio_account_id: 'ca_abc123' },
      ],
      requested_at: '2026-07-04T12:00:00.000Z',
    });
    expect(options).toMatchObject({
      contentType: 'application/json',
      messageId: '665f1a2b3c4d5e6f7a8b9c0d',
      correlationId: '665f1a2b3c4d5e6f7a8b9c0d',
      persistent: true,
    });
    expect(typeof options.timestamp).toBe('number');
  });

  it('publishes an empty connectors array as-is (no connector context requested)', async () => {
    const channel = {
      waitForConnect: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(true),
    };
    const publisher = new RabbitContextRequestPublisher(
      makeConnectionProvider(channel),
    );

    await publisher.publishGatherRequest({
      jobId: 'job-1',
      userId: 'user-1',
      prompt: 'hi',
      connectors: [],
      requestedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const [, , content] = channel.publish.mock.calls[0] as [
      string,
      string,
      Buffer,
    ];
    expect(JSON.parse(content.toString('utf-8')).connectors).toEqual([]);
  });
});
