/**
 * Allowlist of connector providers this API drives through Composio.
 * Adding a provider here also requires a matching `provider:authConfigId`
 * entry in `COMPOSIO_AUTH_CONFIG_IDS` (see `ComposioGateway`).
 */
export enum ConnectorProvider {
  Trello = 'trello',
  Notion = 'notion',
  Github = 'github',
}
