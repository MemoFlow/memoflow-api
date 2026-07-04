import { ConnectorProvider } from './connector-provider';
import { ConnectorStatus } from './connector-status';

/**
 * Port abstracting the Composio connect/status flow. Implemented by
 * `ComposioGateway` (infrastructure only — the only layer allowed to import
 * `@composio/core`). Scope is Branch 1 only: webhook verification and MCP
 * reference lookup land in later branches.
 */
export const CONNECTOR_GATEWAY = Symbol('ConnectorGateway');

export interface InitiateConnectionInput {
  userId: string;
  provider: ConnectorProvider;
}

export interface InitiateConnectionResult {
  redirectUrl: string;
  composioAccountId: string;
  status: ConnectorStatus;
}

export interface ConnectorGateway {
  initiateConnection(
    input: InitiateConnectionInput,
  ): Promise<InitiateConnectionResult>;
  getConnectionStatus(composioAccountId: string): Promise<ConnectorStatus>;
}
