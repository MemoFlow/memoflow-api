import { Inject, Injectable } from '@nestjs/common';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { SyncConnectionStatusUseCase } from './sync-connection-status.use-case';

/**
 * Lists every connector connection (any status) owned by a user.
 *
 * Reconciles (poll fallback) only the `Initiated` rows on the way out —
 * active/revoked/failed rows are already settled, so this bounds the number
 * of Composio calls per list to the still-pending connections.
 */
@Injectable()
export class ListConnectionsUseCase {
  constructor(
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository: ConnectorConnectionRepository,
    private readonly syncConnectionStatusUseCase: SyncConnectionStatusUseCase,
  ) {}

  async execute(userId: string): Promise<ConnectorConnection[]> {
    const connections =
      await this.connectorConnectionRepository.findAllByUser(userId);
    return Promise.all(
      connections.map((connection) =>
        connection.status === ConnectorStatus.Initiated
          ? this.syncConnectionStatusUseCase.reconcile(connection)
          : Promise.resolve(connection),
      ),
    );
  }
}
