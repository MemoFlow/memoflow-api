import { UnauthorizedException } from '@nestjs/common';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import {
  ConnectorConnectionRepository,
  UpdateConnectorStatusData,
} from '../../domain/connectors/connector-connection.repository';
import {
  ConnectorGateway,
  ConnectorWebhookEvent,
} from '../../domain/connectors/connector-gateway.port';
import { ConnectorProvider } from '../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { SyncConnectionStatusUseCase } from './sync-connection-status.use-case';

class InMemoryConnectorConnectionRepository implements ConnectorConnectionRepository {
  updateStatusCalls = 0;

  constructor(private readonly rows: ConnectorConnection[] = []) {}

  findById(id: string): Promise<ConnectorConnection | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  findByUserAndProvider(): Promise<ConnectorConnection | null> {
    return Promise.reject(new Error('not implemented'));
  }

  findByComposioAccountId(
    composioAccountId: string,
  ): Promise<ConnectorConnection | null> {
    return Promise.resolve(
      this.rows.find((row) => row.composioAccountId === composioAccountId) ??
        null,
    );
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
    this.updateStatusCalls += 1;
    const row = this.rows.find((r) => r.id === id);
    if (!row) return Promise.resolve(null);
    row.status = patch.status;
    if (patch.connectedAt !== undefined) row.connectedAt = patch.connectedAt;
    if (patch.composioAccountId !== undefined)
      row.composioAccountId = patch.composioAccountId;
    return Promise.resolve(row);
  }
}

class FakeConnectorGateway implements ConnectorGateway {
  getConnectionStatusResult: ConnectorStatus = ConnectorStatus.Active;
  getConnectionStatusError: Error | null = null;
  getConnectionStatusCalls = 0;
  verifyWebhookResult: ConnectorWebhookEvent | null | Error = new Error(
    'not configured',
  );

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

  verifyWebhook(): Promise<ConnectorWebhookEvent | null> {
    if (this.verifyWebhookResult instanceof Error) {
      return Promise.reject(this.verifyWebhookResult);
    }
    return Promise.resolve(this.verifyWebhookResult);
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
    status: ConnectorStatus.Initiated,
    connectedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('SyncConnectionStatusUseCase', () => {
  describe('applyEvent', () => {
    it('updates status and sets connectedAt when transitioning into Active', async () => {
      const connection = makeConnection();
      const repo = new InMemoryConnectorConnectionRepository([connection]);
      const useCase = new SyncConnectionStatusUseCase(
        repo,
        new FakeConnectorGateway(),
      );

      await useCase.applyEvent({
        composioAccountId: 'ca_123',
        status: ConnectorStatus.Active,
      });

      const updated = await repo.findById('conn-1');
      expect(updated?.status).toBe(ConnectorStatus.Active);
      expect(updated?.connectedAt).toBeInstanceOf(Date);
    });

    it('no-ops (does not throw) for an unknown Composio account', async () => {
      const repo = new InMemoryConnectorConnectionRepository([]);
      const useCase = new SyncConnectionStatusUseCase(
        repo,
        new FakeConnectorGateway(),
      );

      await expect(
        useCase.applyEvent({
          composioAccountId: 'ca_unknown',
          status: ConnectorStatus.Active,
        }),
      ).resolves.toBeUndefined();
    });

    it('is idempotent — applying the same status twice does not change connectedAt again', async () => {
      const connection = makeConnection();
      const repo = new InMemoryConnectorConnectionRepository([connection]);
      const useCase = new SyncConnectionStatusUseCase(
        repo,
        new FakeConnectorGateway(),
      );

      await useCase.applyEvent({
        composioAccountId: 'ca_123',
        status: ConnectorStatus.Active,
      });
      const firstConnectedAt = (await repo.findById('conn-1'))?.connectedAt;

      await useCase.applyEvent({
        composioAccountId: 'ca_123',
        status: ConnectorStatus.Active,
      });
      const secondConnectedAt = (await repo.findById('conn-1'))?.connectedAt;

      expect(secondConnectedAt).toBe(firstConnectedAt);
    });

    it('refuses to revive a Revoked connection on a stale/retried ACTIVE webhook', async () => {
      const connection = makeConnection({ status: ConnectorStatus.Revoked });
      const repo = new InMemoryConnectorConnectionRepository([connection]);
      const useCase = new SyncConnectionStatusUseCase(
        repo,
        new FakeConnectorGateway(),
      );

      await useCase.applyEvent({
        composioAccountId: 'ca_123',
        status: ConnectorStatus.Active,
      });

      const updated = await repo.findById('conn-1');
      expect(updated?.status).toBe(ConnectorStatus.Revoked);
      expect(repo.updateStatusCalls).toBe(0);
    });

    it('refuses to move a Failed connection out of that terminal state', async () => {
      const connection = makeConnection({ status: ConnectorStatus.Failed });
      const repo = new InMemoryConnectorConnectionRepository([connection]);
      const useCase = new SyncConnectionStatusUseCase(
        repo,
        new FakeConnectorGateway(),
      );

      await useCase.applyEvent({
        composioAccountId: 'ca_123',
        status: ConnectorStatus.Active,
      });

      const updated = await repo.findById('conn-1');
      expect(updated?.status).toBe(ConnectorStatus.Failed);
      expect(repo.updateStatusCalls).toBe(0);
    });
  });

  describe('reconcile', () => {
    it('flips Initiated to Active via the gateway', async () => {
      const connection = makeConnection({ status: ConnectorStatus.Initiated });
      const repo = new InMemoryConnectorConnectionRepository([connection]);
      const gateway = new FakeConnectorGateway();
      gateway.getConnectionStatusResult = ConnectorStatus.Active;
      const useCase = new SyncConnectionStatusUseCase(repo, gateway);

      const result = await useCase.reconcile(connection);

      expect(result.status).toBe(ConnectorStatus.Active);
      expect(result.connectedAt).toBeInstanceOf(Date);
      expect(gateway.getConnectionStatusCalls).toBe(1);
    });

    it('leaves terminal statuses untouched and never calls the gateway', async () => {
      const connection = makeConnection({ status: ConnectorStatus.Active });
      const repo = new InMemoryConnectorConnectionRepository([connection]);
      const gateway = new FakeConnectorGateway();
      const useCase = new SyncConnectionStatusUseCase(repo, gateway);

      const result = await useCase.reconcile(connection);

      expect(result).toBe(connection);
      expect(gateway.getConnectionStatusCalls).toBe(0);
    });

    it('returns the same connection unchanged when Composio still reports Initiated', async () => {
      const connection = makeConnection({ status: ConnectorStatus.Initiated });
      const repo = new InMemoryConnectorConnectionRepository([connection]);
      const gateway = new FakeConnectorGateway();
      gateway.getConnectionStatusResult = ConnectorStatus.Initiated;
      const useCase = new SyncConnectionStatusUseCase(repo, gateway);

      const result = await useCase.reconcile(connection);

      expect(result).toBe(connection);
    });

    it('falls back to the last-known local status when the Composio lookup errors, without throwing', async () => {
      const connection = makeConnection({ status: ConnectorStatus.Initiated });
      const repo = new InMemoryConnectorConnectionRepository([connection]);
      const gateway = new FakeConnectorGateway();
      gateway.getConnectionStatusError = new Error('Composio is down');
      const useCase = new SyncConnectionStatusUseCase(repo, gateway);

      const result = await useCase.reconcile(connection);

      expect(result).toBe(connection);
      expect(result.status).toBe(ConnectorStatus.Initiated);
    });
  });

  describe('verifyAndApply', () => {
    it('applies the verified event on a valid signature', async () => {
      const connection = makeConnection();
      const repo = new InMemoryConnectorConnectionRepository([connection]);
      const gateway = new FakeConnectorGateway();
      gateway.verifyWebhookResult = {
        composioAccountId: 'ca_123',
        status: ConnectorStatus.Active,
      };
      const useCase = new SyncConnectionStatusUseCase(repo, gateway);

      await useCase.verifyAndApply('{}', {
        id: 'msg_1',
        timestamp: '1700000000',
        signature: 'v1,fake',
      });

      const updated = await repo.findById('conn-1');
      expect(updated?.status).toBe(ConnectorStatus.Active);
    });

    it('throws UnauthorizedException when the gateway rejects the signature', async () => {
      const repo = new InMemoryConnectorConnectionRepository([]);
      const gateway = new FakeConnectorGateway();
      gateway.verifyWebhookResult = new Error('bad signature');
      const useCase = new SyncConnectionStatusUseCase(repo, gateway);

      await expect(
        useCase.verifyAndApply('{}', {
          id: 'msg_1',
          timestamp: '1700000000',
          signature: 'v1,bad',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('acks a validly-signed non-connection event as a no-op (not a 401)', async () => {
      const connection = makeConnection();
      const repo = new InMemoryConnectorConnectionRepository([connection]);
      const gateway = new FakeConnectorGateway();
      gateway.verifyWebhookResult = null;
      const useCase = new SyncConnectionStatusUseCase(repo, gateway);

      await expect(
        useCase.verifyAndApply('{}', {
          id: 'msg_1',
          timestamp: '1700000000',
          signature: 'v1,fake',
        }),
      ).resolves.toBeUndefined();

      const untouched = await repo.findById('conn-1');
      expect(untouched?.status).toBe(ConnectorStatus.Initiated);
      expect(repo.updateStatusCalls).toBe(0);
    });
  });
});
