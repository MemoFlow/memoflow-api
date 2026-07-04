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
import { RevokeConnectionUseCase } from './revoke-connection.use-case';
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
  revokedAccountIds: string[] = [];

  initiateConnection(): ReturnType<ConnectorGateway['initiateConnection']> {
    return Promise.reject(new Error('not implemented'));
  }

  getConnectionStatus(): Promise<ConnectorStatus> {
    return Promise.reject(new Error('not implemented'));
  }

  verifyWebhook(): ReturnType<ConnectorGateway['verifyWebhook']> {
    return Promise.reject(new Error('not implemented'));
  }

  revoke(composioAccountId: string): Promise<void> {
    this.revokedAccountIds.push(composioAccountId);
    return Promise.resolve();
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

describe('RevokeConnectionUseCase', () => {
  it("revokes the owner's connection: calls the gateway and marks it Revoked", async () => {
    const connection = makeConnection();
    const repo = new InMemoryConnectorConnectionRepository([connection]);
    const gateway = new FakeConnectorGateway();
    const syncUseCase = new SyncConnectionStatusUseCase(repo, gateway);
    const getUseCase = new GetConnectionUseCase(repo, syncUseCase);
    const useCase = new RevokeConnectionUseCase(getUseCase, gateway, repo);

    const result = await useCase.execute({
      connectionId: 'conn-1',
      userId: 'user-1',
    });

    expect(gateway.revokedAccountIds).toEqual(['ca_123']);
    expect(result.status).toBe(ConnectorStatus.Revoked);
  });

  it("404s (does not call the gateway) for another user's connection", async () => {
    const connection = makeConnection({ userId: 'user-1' });
    const repo = new InMemoryConnectorConnectionRepository([connection]);
    const gateway = new FakeConnectorGateway();
    const syncUseCase = new SyncConnectionStatusUseCase(repo, gateway);
    const getUseCase = new GetConnectionUseCase(repo, syncUseCase);
    const useCase = new RevokeConnectionUseCase(getUseCase, gateway, repo);

    await expect(
      useCase.execute({ connectionId: 'conn-1', userId: 'user-2' }),
    ).rejects.toThrow(NotFoundException);
    expect(gateway.revokedAccountIds).toEqual([]);
  });

  it('404s for a missing connection', async () => {
    const repo = new InMemoryConnectorConnectionRepository([]);
    const gateway = new FakeConnectorGateway();
    const syncUseCase = new SyncConnectionStatusUseCase(repo, gateway);
    const getUseCase = new GetConnectionUseCase(repo, syncUseCase);
    const useCase = new RevokeConnectionUseCase(getUseCase, gateway, repo);

    await expect(
      useCase.execute({ connectionId: 'missing', userId: 'user-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('is idempotent: revoking an already-Revoked connection does not call the gateway again', async () => {
    const connection = makeConnection({ status: ConnectorStatus.Revoked });
    const repo = new InMemoryConnectorConnectionRepository([connection]);
    const gateway = new FakeConnectorGateway();
    const syncUseCase = new SyncConnectionStatusUseCase(repo, gateway);
    const getUseCase = new GetConnectionUseCase(repo, syncUseCase);
    const useCase = new RevokeConnectionUseCase(getUseCase, gateway, repo);

    const result = await useCase.execute({
      connectionId: 'conn-1',
      userId: 'user-1',
    });

    expect(gateway.revokedAccountIds).toEqual([]);
    expect(result.status).toBe(ConnectorStatus.Revoked);
  });

  it('a retried DELETE (revoke twice) only calls the gateway once', async () => {
    const connection = makeConnection();
    const repo = new InMemoryConnectorConnectionRepository([connection]);
    const gateway = new FakeConnectorGateway();
    const syncUseCase = new SyncConnectionStatusUseCase(repo, gateway);
    const getUseCase = new GetConnectionUseCase(repo, syncUseCase);
    const useCase = new RevokeConnectionUseCase(getUseCase, gateway, repo);

    await useCase.execute({ connectionId: 'conn-1', userId: 'user-1' });
    const second = await useCase.execute({
      connectionId: 'conn-1',
      userId: 'user-1',
    });

    expect(gateway.revokedAccountIds).toEqual(['ca_123']);
    expect(second.status).toBe(ConnectorStatus.Revoked);
  });
});
