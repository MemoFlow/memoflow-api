import { Inject, Injectable } from '@nestjs/common';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';

/**
 * Lists every connector connection (any status) owned by a user.
 */
@Injectable()
export class ListConnectionsUseCase {
  constructor(
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository: ConnectorConnectionRepository,
  ) {}

  async execute(userId: string): Promise<ConnectorConnection[]> {
    return this.connectorConnectionRepository.findAllByUser(userId);
  }
}
