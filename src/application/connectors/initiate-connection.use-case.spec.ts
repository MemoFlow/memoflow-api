import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import {
  ConnectorConnectionRepository,
  UpdateConnectorStatusData,
  UpsertInitiatedData,
} from '../../domain/connectors/connector-connection.repository';
import {
  ConnectorGateway,
  InitiateConnectionInput as GatewayInitiateInput,
  InitiateConnectionResult,
} from '../../domain/connectors/connector-gateway.port';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { InitiateConnectionUseCase } from './initiate-connection.use-case';

class InMemoryConnectorConnectionRepository implements ConnectorConnectionRepository {
  private readonly rows = new Map<string, ConnectorConnection>();
  private nextId = 1;

  findById(id: string): Promise<ConnectorConnection | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  findByUserAndProvider(
    userId: string,
    provider: ConnectorProvider,
  ): Promise<ConnectorConnection | null> {
    const found = [...this.rows.values()].find(
      (row) => row.userId === userId && row.provider === provider,
    );
    return Promise.resolve(found ?? null);
  }

  findByComposioAccountId(
    composioAccountId: string,
  ): Promise<ConnectorConnection | null> {
    const found = [...this.rows.values()].find(
      (row) => row.composioAccountId === composioAccountId,
    );
    return Promise.resolve(found ?? null);
  }

  findAllByUser(userId: string): Promise<ConnectorConnection[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.userId === userId),
    );
  }

  findActiveByUser(userId: string): Promise<ConnectorConnection[]> {
    return Promise.resolve(
      [...this.rows.values()].filter(
        (row) => row.userId === userId && row.status === ConnectorStatus.Active,
      ),
    );
  }

  async upsertInitiated(
    data: UpsertInitiatedData,
  ): Promise<ConnectorConnection> {
    const existing = await this.findByUserAndProvider(
      data.userId,
      data.provider,
    );
    const now = new Date();
    const row = new ConnectorConnection({
      id: existing?.id ?? `conn-${this.nextId++}`,
      userId: data.userId,
      provider: data.provider,
      composioAccountId: data.composioAccountId,
      status: ConnectorStatus.Initiated,
      connectedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.rows.set(row.id, row);
    return row;
  }

  updateStatus(
    id: string,
    patch: UpdateConnectorStatusData,
  ): Promise<ConnectorConnection | null> {
    const existing = this.rows.get(id);
    if (!existing) return Promise.resolve(null);
    const updated = new ConnectorConnection({
      ...existing,
      status: patch.status,
      composioAccountId:
        patch.composioAccountId !== undefined
          ? patch.composioAccountId
          : existing.composioAccountId,
      connectedAt:
        patch.connectedAt !== undefined
          ? patch.connectedAt
          : existing.connectedAt,
      updatedAt: new Date(),
    });
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }
}

class FakeConnectorGateway implements ConnectorGateway {
  public initiateCalls: GatewayInitiateInput[] = [];

  constructor(
    private readonly result: InitiateConnectionResult = {
      redirectUrl: 'https://composio.dev/connect/abc',
      composioAccountId: 'ca_abc123',
      status: ConnectorStatus.Initiated,
    },
  ) {}

  initiateConnection(
    input: GatewayInitiateInput,
  ): Promise<InitiateConnectionResult> {
    this.initiateCalls.push(input);
    return Promise.resolve(this.result);
  }

  getConnectionStatus(): Promise<ConnectorStatus> {
    return Promise.reject(new Error('not implemented'));
  }

  verifyWebhook(): ReturnType<ConnectorGateway['verifyWebhook']> {
    return Promise.reject(new Error('not implemented'));
  }

  revoke(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
}

describe('InitiateConnectionUseCase', () => {
  it('initiates via the gateway and persists an Initiated row', async () => {
    const gateway = new FakeConnectorGateway();
    const repository = new InMemoryConnectorConnectionRepository();
    const useCase = new InitiateConnectionUseCase(gateway, repository);

    const result = await useCase.execute({
      userId: 'user-1',
      provider: ConnectorProvider.Trello,
    });

    expect(gateway.initiateCalls).toEqual([
      { userId: 'user-1', provider: ConnectorProvider.Trello },
    ]);
    expect(result.redirectUrl).toBe('https://composio.dev/connect/abc');
    expect(result.status).toBe(ConnectorStatus.Initiated);
    expect(result.connectionId).toEqual(expect.any(String));

    const persisted = await repository.findById(result.connectionId);
    expect(persisted?.composioAccountId).toBe('ca_abc123');
    expect(persisted?.status).toBe(ConnectorStatus.Initiated);
  });

  it('reconnecting the same user+provider overwrites the previous row instead of creating a second one', async () => {
    const repository = new InMemoryConnectorConnectionRepository();
    const firstGateway = new FakeConnectorGateway({
      redirectUrl: 'https://composio.dev/connect/first',
      composioAccountId: 'ca_first',
      status: ConnectorStatus.Initiated,
    });
    const firstUseCase = new InitiateConnectionUseCase(
      firstGateway,
      repository,
    );
    const first = await firstUseCase.execute({
      userId: 'user-1',
      provider: ConnectorProvider.Notion,
    });

    const secondGateway = new FakeConnectorGateway({
      redirectUrl: 'https://composio.dev/connect/second',
      composioAccountId: 'ca_second',
      status: ConnectorStatus.Initiated,
    });
    const secondUseCase = new InitiateConnectionUseCase(
      secondGateway,
      repository,
    );
    const second = await secondUseCase.execute({
      userId: 'user-1',
      provider: ConnectorProvider.Notion,
    });

    expect(second.connectionId).toBe(first.connectionId);
    const all = await repository.findAllByUser('user-1');
    expect(all).toHaveLength(1);
    expect(all[0].composioAccountId).toBe('ca_second');
  });
});
