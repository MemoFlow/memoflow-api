import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';

export interface GetConnectionInput {
  connectionId: string;
  userId: string;
}

/**
 * Reads a connector connection, scoped to its owner. Mirrors
 * `GetPlanningJobUseCase`: a missing row and a row owned by someone else
 * both 404, never leaking whether another user's connection id exists.
 */
@Injectable()
export class GetConnectionUseCase {
  constructor(
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository: ConnectorConnectionRepository,
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
    return connection;
  }
}
