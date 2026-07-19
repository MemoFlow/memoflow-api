import type { ConnectorMcpReference } from '../connectors/connector-gateway.port';

/**
 * Port abstracting the RabbitMQ context-gather request producer
 * (`docs/contracts/context-engine.md` §1-2: publishes to the `context`
 * topic exchange, routing key `ctx.gather.request`, consumed by the
 * `ctx.gather.requests` queue). Implemented by `RabbitContextRequestPublisher`
 * (infrastructure only — the only layer allowed to import `amqplib`/
 * `amqp-connection-manager`). Only provided by `ContextModule` when
 * `RABBITMQ_URL` is configured; `ProcessPlanningJobUseCase` injects it
 * `@Optional()` and falls back to the legacy synchronous HTTP/stub gather
 * path when it's absent.
 */
export const CONTEXT_REQUEST_PUBLISHER = Symbol('ContextRequestPublisher');

/**
 * Mirrors `context-request.schema.json` — `connectors` reuses the existing
 * `ConnectorMcpReference` shape (same fields the legacy
 * `ContextEngineHttpClient` path already builds from active connector
 * connections) rather than inventing a parallel type.
 */
export interface GatherRequestInput {
  jobId: string;
  userId: string;
  prompt: string;
  connectors: ConnectorMcpReference[];
  requestedAt: Date;
}

export interface ContextRequestPublisher {
  /**
   * Publishes the request message. `job_id` is the contract's idempotency
   * key on the CE side — republishing the same `jobId` (e.g. a BullMQ
   * retry) must not trigger a second gather, which is the CE's
   * responsibility per the contract, not this port's.
   */
  publishGatherRequest(input: GatherRequestInput): Promise<void>;
}
