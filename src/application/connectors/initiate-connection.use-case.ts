import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { CONNECTOR_STATUS_CHANGED_EVENT } from '../../domain/connectors/connector-events';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { CONNECTOR_GATEWAY } from '../../domain/connectors/connector-gateway.port';
import type { ConnectorGateway } from '../../domain/connectors/connector-gateway.port';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../domain/connectors/connector-status';

export interface InitiateConnectionInput {
  userId: string;
  provider: ConnectorProvider;
}

export interface InitiateConnectionOutput {
  redirectUrl: string;
  connectionId: string;
  status: ConnectorStatus;
}

/**
 * Drives Composio's connect flow for a user+provider, then persists the
 * connection reference (`composio_account_id`, `Initiated`) — never a raw
 * provider token. Idempotent per user+provider: reconnecting overwrites the
 * previous row via `upsertInitiated`. Because that drops our only reference
 * to the previous Composio account, it is revoked at Composio (best effort)
 * once the new row is stored, so no orphaned connected account is left behind.
 * Later webhooks for the old account id match no row and are ignored.
 */
@Injectable()
export class InitiateConnectionUseCase {
  private readonly logger = new Logger(InitiateConnectionUseCase.name);

  constructor(
    @Inject(CONNECTOR_GATEWAY)
    private readonly connectorGateway: ConnectorGateway,
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository: ConnectorConnectionRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(
    input: InitiateConnectionInput,
  ): Promise<InitiateConnectionOutput> {
    // Read before the upsert overwrites the row.
    const previous =
      await this.connectorConnectionRepository.findByUserAndProvider(
        input.userId,
        input.provider,
      );

    const { redirectUrl, composioAccountId, status } =
      await this.connectorGateway.initiateConnection({
        userId: input.userId,
        provider: input.provider,
      });

    const row = await this.connectorConnectionRepository.upsertInitiated({
      userId: input.userId,
      provider: input.provider,
      composioAccountId,
    });

    // The row is back to `initiated`, so a previously active connector no
    // longer counts toward the owner's lead score.
    this.eventEmitter.emit(CONNECTOR_STATUS_CHANGED_EVENT, {
      userId: input.userId,
    });

    await this.revokeReplacedAccount(previous, composioAccountId, row.id);

    return { redirectUrl, connectionId: row.id, status };
  }

  /**
   * Best effort: a failure here must not fail the reconnect (the new
   * connection is already stored), so it only logs ids — never tokens.
   */
  private async revokeReplacedAccount(
    previous: ConnectorConnection | null,
    newComposioAccountId: string,
    connectionId: string,
  ): Promise<void> {
    const oldAccountId = previous?.composioAccountId;
    if (
      !previous ||
      !oldAccountId ||
      oldAccountId === newComposioAccountId ||
      previous.status === ConnectorStatus.Revoked
    ) {
      return;
    }
    try {
      await this.connectorGateway.revoke(oldAccountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to revoke replaced Composio account for connection ${connectionId} (provider ${previous.provider}): ${message}`,
      );
    }
  }
}
