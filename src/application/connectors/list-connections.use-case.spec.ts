import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { ListConnectionsUseCase } from './list-connections.use-case';

class InMemoryConnectorConnectionRepository implements ConnectorConnectionRepository {
  constructor(private readonly rows: ConnectorConnection[] = []) {}

  findById(id: string): Promise<ConnectorConnection | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  findByUserAndProvider(): Promise<ConnectorConnection | null> {
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

  updateStatus(): Promise<ConnectorConnection | null> {
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

describe('ListConnectionsUseCase', () => {
  it("returns only the requesting user's connections", async () => {
    const own = makeConnection({ id: 'conn-1', userId: 'user-1' });
    const other = makeConnection({ id: 'conn-2', userId: 'user-2' });
    const useCase = new ListConnectionsUseCase(
      new InMemoryConnectorConnectionRepository([own, other]),
    );

    const result = await useCase.execute('user-1');

    expect(result).toEqual([own]);
  });

  it('returns an empty array when the user has no connections', async () => {
    const useCase = new ListConnectionsUseCase(
      new InMemoryConnectorConnectionRepository([]),
    );

    const result = await useCase.execute('user-1');

    expect(result).toEqual([]);
  });
});
