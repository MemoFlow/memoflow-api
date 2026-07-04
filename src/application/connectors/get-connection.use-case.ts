import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { SyncConnectionStatusUseCase } from './sync-connection-status.use-case';

export interface GetConnectionInput {
  connectionId: string;
  userId: string;
}

/**
 * Reads a connector connection, scoped to its owner. Mirrors
 * `GetPlanningJobUseCase`: a missing row and a row owned by someone else
 * both 404, never leaking whether another user's connection id exists.
 *
 * Reconciles (poll fallback) on the way out: the ownership check runs
 * first, so a non-owner still 404s before any Composio call is made.
 */
@Injectable()
export class GetConnectionUseCase {
  constructor(
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository: ConnectorConnectionRepository,
    private readonly syncConnectionStatusUseCase: SyncConnectionStatusUseCase,
  ) {}

  async execute(input: GetConnectionInput): Promise<ConnectorConnection> {
    const connection = await this.connectorConnectionRepository.findById(
      input.connectionId,
    );
    if (!connection || connection.userId !== input.userId) {
      throw new NotFoundException(
        `Connector connection ${input.connectionId} not found`,
      );
    }
    return this.syncConnectionStatusUseCase.reconcile(connection);
  }
}
