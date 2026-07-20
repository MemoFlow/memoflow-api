import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CONNECTOR_REVOKED_EVENT } from '../../domain/audit/audit-events';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { CONNECTOR_GATEWAY } from '../../domain/connectors/connector-gateway.port';
import type { ConnectorGateway } from '../../domain/connectors/connector-gateway.port';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { GetConnectionUseCase } from './get-connection.use-case';

export interface RevokeConnectionInput {
  connectionId: string;
  userId: string;
}

/**
 * Revokes a connector connection: tells Composio to delete the connected
 * account (so it can no longer be used), then marks the local row
 * `Revoked`. Owner-scoped via `GetConnectionUseCase` — a missing row or one
 * owned by someone else 404s before any Composio call is made.
 */
@Injectable()
export class RevokeConnectionUseCase {
  constructor(
    private readonly getConnectionUseCase: GetConnectionUseCase,
    @Inject(CONNECTOR_GATEWAY)
    private readonly connectorGateway: ConnectorGateway,
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository: ConnectorConnectionRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: RevokeConnectionInput): Promise<ConnectorConnection> {
    // Owner check (404 on mismatch) happens before any Composio call.
    // Note: GetConnectionUseCase also reconciles Initiated rows via poll
    // fallback, which is harmless here — a row still Initiated at revoke
    // time simply gets its freshest known status before being revoked.
    const connection = await this.getConnectionUseCase.execute(input);

    if (connection.status === ConnectorStatus.Revoked) {
      // Idempotent: a retried/concurrent DELETE on an already-revoked
      // connection is a no-op — Composio's delete on an already-deleted
      // account can throw, which would otherwise surface as a 500 instead
      // of the idempotent 204 a repeated DELETE should return. No audit
      // event on this path — the actual revoke was already recorded once.
      return connection;
    }

    if (connection.composioAccountId) {
      await this.connectorGateway.revoke(connection.composioAccountId);
    }

    const updated = await this.connectorConnectionRepository.updateStatus(
      connection.id,
      { status: ConnectorStatus.Revoked },
    );
    const result = updated ?? connection;

    this.eventEmitter.emit(CONNECTOR_REVOKED_EVENT, {
      userId: input.userId,
      connectionId: result.id,
      provider: result.provider,
    });

    return result;
  }
}
