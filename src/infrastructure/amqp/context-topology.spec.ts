import {
  assertContextTopology,
  CONTEXT_EXCHANGE,
  CTX_GATHER_REQUEST_ROUTING_KEY,
  CTX_GATHER_REQUESTS_DLQ,
  CTX_GATHER_REQUESTS_QUEUE,
  CTX_GATHER_RESULT_ROUTING_KEY,
  CTX_GATHER_RESULTS_DLQ,
  CTX_GATHER_RESULTS_QUEUE,
} from './context-topology';

describe('assertContextTopology', () => {
  it('idempotently asserts the exchange, both queues + DLQs, and both bindings', async () => {
    const channel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue: jest.fn().mockResolvedValue(undefined),
    };

    await assertContextTopology(channel as any);

    expect(channel.assertExchange).toHaveBeenCalledWith(
      CONTEXT_EXCHANGE,
      'topic',
      {
        durable: true,
      },
    );

    expect(channel.assertQueue).toHaveBeenCalledWith(CTX_GATHER_REQUESTS_DLQ, {
      durable: true,
    });
    expect(channel.assertQueue).toHaveBeenCalledWith(
      CTX_GATHER_REQUESTS_QUEUE,
      {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': CTX_GATHER_REQUESTS_DLQ,
        },
      },
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      CTX_GATHER_REQUESTS_QUEUE,
      CONTEXT_EXCHANGE,
      CTX_GATHER_REQUEST_ROUTING_KEY,
    );

    expect(channel.assertQueue).toHaveBeenCalledWith(CTX_GATHER_RESULTS_DLQ, {
      durable: true,
    });
    expect(channel.assertQueue).toHaveBeenCalledWith(CTX_GATHER_RESULTS_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': CTX_GATHER_RESULTS_DLQ,
      },
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      CTX_GATHER_RESULTS_QUEUE,
      CONTEXT_EXCHANGE,
      CTX_GATHER_RESULT_ROUTING_KEY,
    );
  });
});
