import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import {
  ConnectorConnectionRepository,
  UpdateConnectorStatusData,
} from '../../domain/connectors/connector-connection.repository';
import { ConnectorGateway } from '../../domain/connectors/connector-gateway.port';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { GetConnectionUseCase } from './get-connection.use-case';
import { SyncConnectionStatusUseCase } from './sync-connection-status.use-case';

class InMemoryConnectorConnectionRepository implements ConnectorConnectionRepository {
  constructor(private readonly rows: ConnectorConnection[] = []) {}

  findById(id: string): Promise<ConnectorConnection | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  findByUserAndProvider(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }

  findByComposioAccountId(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }

  findAllByUser(): Promise<ConnectorConnection[]> {
    return Promise.reject(new Error('not implemented'));
  }

  findActiveByUser(): Promise<ConnectorConnection[]> {
    return Promise.reject(new Error('not implemented'));
  }

  upsertInitiated(): Promise<ConnectorConnection> {
    return Promise.reject(new Error('not implemented'));
  }

  updateStatus(
    id: string,
    patch: UpdateConnectorStatusData,
  ): Promise<ConnectorConnection | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return Promise.resolve(null);
    row.status = patch.status;
    if (patch.connectedAt !== undefined) row.connectedAt = patch.connectedAt;
    return Promise.resolve(row);
  }
}

class FakeConnectorGateway implements ConnectorGateway {
  getConnectionStatusResult: ConnectorStatus = ConnectorStatus.Initiated;
  getConnectionStatusCalls = 0;
  getConnectionStatusError: Error | null = null;

  initiateConnection(): ReturnType<ConnectorGateway['initiateConnection']> {
    return Promise.reject(new Error('not implemented'));
  }

  getConnectionStatus(): Promise<ConnectorStatus> {
    this.getConnectionStatusCalls += 1;
    if (this.getConnectionStatusError) {
      return Promise.reject(this.getConnectionStatusError);
    }
    return Promise.resolve(this.getConnectionStatusResult);
  }

  verifyWebhook(): ReturnType<ConnectorGateway['verifyWebhook']> {
    return Promise.reject(new Error('not implemented'));
  }

  revoke(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
}

function makeConnection(
  overrides: Partial<ConnectorConnection> = {},
): ConnectorConnection {
  return new ConnectorConnection({
    id: 'conn-1',
    userId: 'user-1',
    provider: ConnectorProvider.Trello,
    composioAccountId: 'ca_123',
    status: ConnectorStatus.Active,
    connectedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function makeUseCase(
  rows: ConnectorConnection[],
  gateway: FakeConnectorGateway = new FakeConnectorGateway(),
): GetConnectionUseCase {
  const repo = new InMemoryConnectorConnectionRepository(rows);
  const syncUseCase = new SyncConnectionStatusUseCase(repo, gateway, {
    emit: jest.fn(),
  } as unknown as EventEmitter2);
  return new GetConnectionUseCase(repo, syncUseCase);
}

describe('GetConnectionUseCase', () => {
  it('returns the connection when the requesting user owns it', async () => {
    const connection = makeConnection();
    const useCase = makeUseCase([connection]);

    const result = await useCase.execute({
      connectionId: 'conn-1',
      userId: 'user-1',
    });

    expect(result).toBe(connection);
  });

  it('throws NotFoundException when the connection does not exist', async () => {
    const useCase = makeUseCase([]);

    await expect(
      useCase.execute({ connectionId: 'missing', userId: 'user-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException (not Forbidden) when a different user requests the connection, to avoid leaking existence', async () => {
    const connection = makeConnection({
      userId: 'user-1',
      status: ConnectorStatus.Initiated,
    });
    const gateway = new FakeConnectorGateway();
    const useCase = makeUseCase([connection], gateway);

    await expect(
      useCase.execute({ connectionId: 'conn-1', userId: 'user-2' }),
    ).rejects.toThrow(NotFoundException);
    // The ownership check happens before any Composio call.
    expect(gateway.getConnectionStatusCalls).toBe(0);
  });

  it('reconciles an Initiated connection via the poll fallback before returning it', async () => {
    const connection = makeConnection({ status: ConnectorStatus.Initiated });
    const gateway = new FakeConnectorGateway();
    gateway.getConnectionStatusResult = ConnectorStatus.Active;
    const useCase = makeUseCase([connection], gateway);

    const result = await useCase.execute({
      connectionId: 'conn-1',
      userId: 'user-1',
    });

    expect(result.status).toBe(ConnectorStatus.Active);
    expect(result.connectedAt).toBeInstanceOf(Date);
  });

  it('does not call the gateway for an already-terminal connection', async () => {
    const connection = makeConnection({ status: ConnectorStatus.Active });
    const gateway = new FakeConnectorGateway();
    const useCase = makeUseCase([connection], gateway);

    await useCase.execute({ connectionId: 'conn-1', userId: 'user-1' });

    expect(gateway.getConnectionStatusCalls).toBe(0);
  });

  it('returns the local status (does not 500) when the Composio reconcile lookup errors', async () => {
    const connection = makeConnection({ status: ConnectorStatus.Initiated });
    const gateway = new FakeConnectorGateway();
    gateway.getConnectionStatusError = new Error('Composio is down');
    const useCase = makeUseCase([connection], gateway);

    const result = await useCase.execute({
      connectionId: 'conn-1',
      userId: 'user-1',
    });

    expect(result.status).toBe(ConnectorStatus.Initiated);
  });
});
