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

  async onModuleInit(): Promise<void> {
    // Waits for the initial connect + topology assertion so the app only
    // reports "ready" once publishing is actually possible — mirrors how
    // TypeORM/Mongoose already block boot on their own connections when
    // configured.
    await this.channelWrapper.waitForConnect();
    this.logger.log('RabbitMQ context-request publisher ready');
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
      },
    );
  }
}
