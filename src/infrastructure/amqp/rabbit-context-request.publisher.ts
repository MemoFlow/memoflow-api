import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ChannelWrapper } from 'amqp-connection-manager';
import {
  ContextRequestPublisher,
  GatherRequestInput,
} from '../../domain/context/context-request-publisher.port';
import {
  assertContextTopology,
  CONTEXT_EXCHANGE,
  CTX_GATHER_REQUEST_ROUTING_KEY,
} from './context-topology';
import { RabbitMqConnectionProvider } from './rabbitmq-connection.provider';

/** Upper bound on a single publish. `ChannelWrapper.publish` buffers
 * indefinitely while disconnected; without this a dead broker would leave
 * the caller (and its job) hanging. A timeout rejects, which the use-case
 * maps to `CONTEXT_ENGINE_PUBLISH_FAILED`. */
export const PUBLISH_TIMEOUT_MS = 10_000;

/** Wire shape published to `ctx.gather.requests` — mirrors
 * `docs/contracts/context-request.schema.json` exactly (snake_case, as the
 * CE team's schema dictates; the domain-side `GatherRequestInput` stays
 * camelCase). */
interface ContextGatherRequestBody {
  schema_version: 1;
  job_id: string;
  user_id: string;
  prompt: string;
  connectors: Array<{
    provider: string;
    mcp_url: string | null;
    composio_account_id: string;
  }>;
  requested_at: string;
}

/**
 * `ContextRequestPublisher` implementation: publishes to the `context`
 * topic exchange with routing key `ctx.gather.request`
 * (`docs/contracts/context-engine.md` §1-2). Only bound by `ContextModule`
 * when `RABBITMQ_URL` is configured.
 */
@Injectable()
export class RabbitContextRequestPublisher
  implements ContextRequestPublisher, OnModuleInit
{
  private readonly logger = new Logger(RabbitContextRequestPublisher.name);
  private readonly channelWrapper: ChannelWrapper;

  constructor(connectionProvider: RabbitMqConnectionProvider) {
    const connection = connectionProvider.getConnection();
    this.channelWrapper = connection.createChannel({
      name: 'ctx-gather-request-publisher',
      json: false,
      setup: (channel) => assertContextTopology(channel),
    });
  }

  /**
   * Does NOT wait for the broker: Nest blocks listening on `onModuleInit`,
   * so an unreachable `RABBITMQ_URL` must not stop the API from starting.
   * The connection (and topology assertion) continues in the background via
   * amqp-connection-manager's reconnect; publishes made meanwhile are
   * bounded by `PUBLISH_TIMEOUT_MS` and fail rather than hang.
   */
  onModuleInit(): Promise<void> {
    this.channelWrapper.on('connect', () => {
      this.logger.log('RabbitMQ context-request publisher ready');
    });
    this.channelWrapper.on('error', (err: Error) => {
      this.logger.error(
        `RabbitMQ context-request publisher channel error: ${err.message}`,
      );
    });
    return Promise.resolve();
  }

  async publishGatherRequest(input: GatherRequestInput): Promise<void> {
    const body: ContextGatherRequestBody = {
      schema_version: 1,
      job_id: input.jobId,
      user_id: input.userId,
      prompt: input.prompt,
      connectors: input.connectors.map((connector) => ({
        provider: connector.provider,
        mcp_url: connector.mcpUrl,
        composio_account_id: connector.composioAccountId,
      })),
      requested_at: input.requestedAt.toISOString(),
    };

    const content = Buffer.from(JSON.stringify(body), 'utf-8');
    try {
      await this.channelWrapper.publish(
        CONTEXT_EXCHANGE,
        CTX_GATHER_REQUEST_ROUTING_KEY,
        content,
        {
          contentType: 'application/json',
          messageId: input.jobId,
          correlationId: input.jobId,
          persistent: true,
          timestamp: Math.floor(Date.now() / 1000),
          timeout: PUBLISH_TIMEOUT_MS,
        },
      );
    } catch (err) {
      // `error_message` on the job is serialized to clients — keep the
      // broker/library detail (e.g. a bare "timeout") in the logs only.
      this.logger.error(
        `Failed to publish context gather request for job ${input.jobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new Error('Context engine unavailable');
    }
  }
}
