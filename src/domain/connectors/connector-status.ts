/**
 * Lifecycle of a `connector_connections` row (see docs/database-schema.md).
 * Composio is the token vault — this API never sees raw provider tokens,
 * only this status reference plus `composioAccountId`.
 */
export enum ConnectorStatus {
  Initiated = 'initiated',
  Active = 'active',
  Revoked = 'revoked',
  Failed = 'failed',
}
