import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp from 'amqp-connection-manager';
import type { AmqpConnectionManager } from 'amqp-connection-manager';

/**
 * Lazily creates (and owns the lifecycle of) the single
 * `amqp-connection-manager` connection used by both the request publisher
 * and the results consumer. Only ever constructed/injected when
 * `RABBITMQ_URL` is set — `ContextModule` gates all three RabbitMQ
 * providers (this, `RabbitContextRequestPublisher`, `ContextResultsConsumer`)
 * behind that same check, mirroring `CONTEXT_GATHERER`'s
 * `CONTEXT_ENGINE_URL` conditional — so boot never requires it.
 *
 * TLS-ready with no extra config: `amqplib` (which this wraps) negotiates
 * TLS automatically for an `amqps://` URL; a plain `amqp://` URL (local
 * dev/e2e against a Testcontainers broker) stays unencrypted, same as
 * `POSTGRES_SSL`/`REDIS_TLS` being opt-in elsewhere in this codebase.
 */
@Injectable()
export class RabbitMqConnectionProvider implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqConnectionProvider.name);
  private connection: AmqpConnectionManager | null = null;

  constructor(private readonly config: ConfigService) {}

  getConnection(): AmqpConnectionManager {
    if (!this.connection) {
      const url = this.config.getOrThrow<string>('RABBITMQ_URL');
      this.connection = amqp.connect([url], {
        heartbeatIntervalInSeconds: 10,
      });
      this.connection.on('connectFailed', ({ err }) => {
        this.logger.error(`RabbitMQ connect failed: ${err.message}`);
      });
      this.connection.on('disconnect', ({ err }) => {
        this.logger.warn(`RabbitMQ disconnected: ${err.message}`);
      });
    }
    return this.connection;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.close();
  }
}
