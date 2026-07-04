import { Inject, Injectable } from '@nestjs/common';
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
 * previous row via `upsertInitiated`.
 */
@Injectable()
export class InitiateConnectionUseCase {
  constructor(
    @Inject(CONNECTOR_GATEWAY)
    private readonly connectorGateway: ConnectorGateway,
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository: ConnectorConnectionRepository,
  ) {}

  async execute(
    input: InitiateConnectionInput,
  ): Promise<InitiateConnectionOutput> {
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

    return { redirectUrl, connectionId: row.id, status };
  }
}
