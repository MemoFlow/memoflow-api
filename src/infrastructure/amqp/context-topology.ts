import type { Channel } from 'amqp-connection-manager';

/**
 * RabbitMQ topology constants for the context-engine transport
 * (`docs/contracts/context-engine.md` §1). Deliberately NOT env-configurable
 * (per the implementation brief) — only the broker URL (`RABBITMQ_URL`) is.
 */
export const CONTEXT_EXCHANGE = 'context';
export const CTX_GATHER_REQUEST_ROUTING_KEY = 'ctx.gather.request';
export const CTX_GATHER_REQUESTS_QUEUE = 'ctx.gather.requests';
export const CTX_GATHER_REQUESTS_DLQ = 'ctx.gather.requests.dlq';
export const CTX_GATHER_RESULT_ROUTING_KEY = 'ctx.gather.result';
export const CTX_GATHER_RESULTS_QUEUE = 'ctx.gather.results';
export const CTX_GATHER_RESULTS_DLQ = 'ctx.gather.results.dlq';

/**
 * Idempotently asserts the full topology: the `context` topic exchange,
 * both queues (durable, dead-lettering to their own DLQ via the default
 * exchange — no separate DLX exchange needed since the default exchange
 * already routes by queue name), their DLQs, and both bindings. Safe to run
 * on every (re)connect — `assert*`/`bindQueue` are idempotent in AMQP.
 *
 * Used as the `setup` function for both the publisher's and the consumer's
 * `ChannelWrapper` — whichever connects first asserts the topology; the
 * other's identical assertion is then a no-op.
 */
export async function assertContextTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(CONTEXT_EXCHANGE, 'topic', { durable: true });

  await channel.assertQueue(CTX_GATHER_REQUESTS_DLQ, { durable: true });
  await channel.assertQueue(CTX_GATHER_REQUESTS_QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': CTX_GATHER_REQUESTS_DLQ,
    },
  });
  await channel.bindQueue(
    CTX_GATHER_REQUESTS_QUEUE,
    CONTEXT_EXCHANGE,
    CTX_GATHER_REQUEST_ROUTING_KEY,
  );

  await channel.assertQueue(CTX_GATHER_RESULTS_DLQ, { durable: true });
  await channel.assertQueue(CTX_GATHER_RESULTS_QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': CTX_GATHER_RESULTS_DLQ,
    },
  });
  await channel.bindQueue(
    CTX_GATHER_RESULTS_QUEUE,
    CONTEXT_EXCHANGE,
    CTX_GATHER_RESULT_ROUTING_KEY,
  );
}
