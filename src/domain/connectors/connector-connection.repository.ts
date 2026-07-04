import { ConnectorConnection } from './connector-connection.entity';
import { ConnectorProvider } from './connector-provider';
import { ConnectorStatus } from './connector-status';

export const CONNECTOR_CONNECTION_REPOSITORY = Symbol(
  'ConnectorConnectionRepository',
);

export interface UpsertInitiatedData {
  userId: string;
  provider: ConnectorProvider;
  composioAccountId: string;
}

export interface UpdateConnectorStatusData {
  status: ConnectorStatus;
  composioAccountId?: string;
  connectedAt?: Date | null;
}

export interface ConnectorConnectionRepository {
  findById(id: string): Promise<ConnectorConnection | null>;
  findByUserAndProvider(
    userId: string,
    provider: ConnectorProvider,
  ): Promise<ConnectorConnection | null>;
  /**
   * Looks a connection up by its Composio connected-account id — used by
   * `SyncConnectionStatusUseCase.applyEvent` to resolve a webhook's account
   * id back to the owning row.
   */
  findByComposioAccountId(
    composioAccountId: string,
  ): Promise<ConnectorConnection | null>;
  findAllByUser(userId: string): Promise<ConnectorConnection[]>;
  findActiveByUser(userId: string): Promise<ConnectorConnection[]>;
  /**
   * Creates the user+provider row if it doesn't exist yet, or resets an
   * existing one back to `Initiated` with the new Composio account
   * reference — a user reconnecting a provider always starts a fresh
   * connection request.
   */
  upsertInitiated(data: UpsertInitiatedData): Promise<ConnectorConnection>;
  updateStatus(
    id: string,
    patch: UpdateConnectorStatusData,
  ): Promise<ConnectorConnection | null>;
}
