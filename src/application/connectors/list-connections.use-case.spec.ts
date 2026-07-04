import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import {
  ConnectorConnectionRepository,
  UpdateConnectorStatusData,
} from '../../domain/connectors/connector-connection.repository';
import { ConnectorGateway } from '../../domain/connectors/connector-gateway.port';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { ListConnectionsUseCase } from './list-connections.use-case';
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

  findAllByUser(userId: string): Promise<ConnectorConnection[]> {
    return Promise.resolve(this.rows.filter((row) => row.userId === userId));
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
  statusByAccountId = new Map<string, ConnectorStatus>();
  getConnectionStatusCalls = 0;
  getConnectionStatusError: Error | null = null;

  initiateConnection(): ReturnType<ConnectorGateway['initiateConnection']> {
    return Promise.reject(new Error('not implemented'));
  }

  getConnectionStatus(composioAccountId: string): Promise<ConnectorStatus> {
    this.getConnectionStatusCalls += 1;
    if (this.getConnectionStatusError) {
      return Promise.reject(this.getConnectionStatusError);
    }
    return Promise.resolve(
      this.statusByAccountId.get(composioAccountId) ??
        ConnectorStatus.Initiated,
    );
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
    provider: ConnectorProvider.Github,
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
): ListConnectionsUseCase {
  const repo = new InMemoryConnectorConnectionRepository(rows);
  const syncUseCase = new SyncConnectionStatusUseCase(repo, gateway);
  return new ListConnectionsUseCase(repo, syncUseCase);
}

describe('ListConnectionsUseCase', () => {
  it("returns only the requesting user's connections", async () => {
    const own = makeConnection({ id: 'conn-1', userId: 'user-1' });
    const other = makeConnection({ id: 'conn-2', userId: 'user-2' });
    const useCase = makeUseCase([own, other]);

    const result = await useCase.execute('user-1');

    expect(result).toEqual([own]);
  });

  it('returns an empty array when the user has no connections', async () => {
    const useCase = makeUseCase([]);

    const result = await useCase.execute('user-1');

    expect(result).toEqual([]);
  });

  it('reconciles only the Initiated rows, leaving active/terminal rows untouched', async () => {
    const active = makeConnection({
      id: 'conn-1',
      composioAccountId: 'ca_active',
      status: ConnectorStatus.Active,
    });
    const initiated = makeConnection({
      id: 'conn-2',
      composioAccountId: 'ca_initiated',
      status: ConnectorStatus.Initiated,
      connectedAt: null,
    });
    const gateway = new FakeConnectorGateway();
    gateway.statusByAccountId.set('ca_initiated', ConnectorStatus.Active);
    const useCase = makeUseCase([active, initiated], gateway);

    const result = await useCase.execute('user-1');

    expect(gateway.getConnectionStatusCalls).toBe(1);
    const updatedInitiated = result.find((row) => row.id === 'conn-2');
    expect(updatedInitiated?.status).toBe(ConnectorStatus.Active);
    const untouchedActive = result.find((row) => row.id === 'conn-1');
    expect(untouchedActive).toBe(active);
  });

  it('falls back to the local status for a row when the Composio reconcile call errors, without failing the whole list', async () => {
    const active = makeConnection({
      id: 'conn-1',
      composioAccountId: 'ca_active',
      status: ConnectorStatus.Active,
    });
    const initiated = makeConnection({
      id: 'conn-2',
      composioAccountId: 'ca_initiated',
      status: ConnectorStatus.Initiated,
      connectedAt: null,
    });
    const gateway = new FakeConnectorGateway();
    gateway.getConnectionStatusError = new Error('Composio rate-limited');
    const useCase = makeUseCase([active, initiated], gateway);

    const result = await useCase.execute('user-1');

    expect(result).toHaveLength(2);
    const stillInitiated = result.find((row) => row.id === 'conn-2');
    expect(stillInitiated?.status).toBe(ConnectorStatus.Initiated);
    const untouchedActive = result.find((row) => row.id === 'conn-1');
    expect(untouchedActive).toBe(active);
  });
});
