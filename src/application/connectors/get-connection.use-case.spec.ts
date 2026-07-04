import { NotFoundException } from '@nestjs/common';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { GetConnectionUseCase } from './get-connection.use-case';

class InMemoryConnectorConnectionRepository implements ConnectorConnectionRepository {
  constructor(private readonly rows: ConnectorConnection[] = []) {}

  findById(id: string): Promise<ConnectorConnection | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  findByUserAndProvider(): Promise<ConnectorConnection | null> {
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
    provider: ConnectorProvider.Trello,
    composioAccountId: 'ca_123',
    status: ConnectorStatus.Active,
    connectedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('GetConnectionUseCase', () => {
  it('returns the connection when the requesting user owns it', async () => {
    const connection = makeConnection();
    const useCase = new GetConnectionUseCase(
      new InMemoryConnectorConnectionRepository([connection]),
    );

    const result = await useCase.execute({
      connectionId: 'conn-1',
      userId: 'user-1',
    });

    expect(result).toBe(connection);
  });

  it('throws NotFoundException when the connection does not exist', async () => {
    const useCase = new GetConnectionUseCase(
      new InMemoryConnectorConnectionRepository([]),
    );

    await expect(
      useCase.execute({ connectionId: 'missing', userId: 'user-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException (not Forbidden) when a different user requests the connection, to avoid leaking existence', async () => {
    const connection = makeConnection({ userId: 'user-1' });
    const useCase = new GetConnectionUseCase(
      new InMemoryConnectorConnectionRepository([connection]),
    );

    await expect(
      useCase.execute({ connectionId: 'conn-1', userId: 'user-2' }),
    ).rejects.toThrow(NotFoundException);
  });
});
