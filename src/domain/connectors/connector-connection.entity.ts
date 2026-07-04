import { ConnectorProvider } from './connector-provider';
import { ConnectorStatus } from './connector-status';

/**
 * Domain entity for `connector_connections` (see docs/database-schema.md).
 * Plain TypeScript — no typeorm imports. Stores a *reference* to a Composio
 * connected account, never a raw provider token.
 */
export class ConnectorConnection {
  id: string;
  userId: string;
  provider: ConnectorProvider;
  composioAccountId: string | null;
  status: ConnectorStatus;
  connectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: {
    id: string;
    userId: string;
    provider: ConnectorProvider;
    composioAccountId: string | null;
    status: ConnectorStatus;
    connectedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = props.id;
    this.userId = props.userId;
    this.provider = props.provider;
    this.composioAccountId = props.composioAccountId;
    this.status = props.status;
    this.connectedAt = props.connectedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
