import { ConnectorProvider } from './connector-provider';
import { ConnectorStatus } from './connector-status';

/**
 * Port abstracting the Composio connect/status/webhook/revoke flow.
 * Implemented by `ComposioGateway` (infrastructure only — the only layer
 * allowed to import `@composio/core`).
 */
export const CONNECTOR_GATEWAY = Symbol('ConnectorGateway');

/**
 * Normalized reference to a connector's Composio MCP server, deliberately
 * not leaking any `@composio/core` SDK types into the domain. Built directly
 * from an active `ConnectorConnection` row (see
 * `ContextEngineHttpClient.gatherContext`) — no extra Composio round trip.
 * `mcpUrl` is always `null`: this API doesn't provision a user-scoped MCP URL
 * in a single clean call for the installed SDK version, so the external
 * context engine (which also holds Composio credentials) resolves the MCP
 * server itself from `provider` + `composioAccountId`.
 */
export interface ConnectorMcpReference {
  provider: ConnectorProvider;
  mcpUrl: string | null;
  composioAccountId: string;
}

export interface InitiateConnectionInput {
  userId: string;
  provider: ConnectorProvider;
}

export interface InitiateConnectionResult {
  redirectUrl: string;
  composioAccountId: string;
  status: ConnectorStatus;
}

/**
 * Normalized shape of a Composio connected-account webhook event — deliberately
 * does not leak Composio's raw event/payload types into the domain.
 */
export interface ConnectorWebhookEvent {
  composioAccountId: string;
  status: ConnectorStatus;
}

/**
 * The three headers Composio's HMAC scheme signs together
 * (`webhook-id`, `webhook-timestamp`, `webhook-signature` — see the
 * `@composio/core` `Triggers.verifyWebhook` doc comment). The signature
 * alone can't be verified without the other two, so all three travel as a
 * unit through the port rather than a bare signature string.
 */
export interface ConnectorWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

export interface ConnectorGateway {
  initiateConnection(
    input: InitiateConnectionInput,
  ): Promise<InitiateConnectionResult>;
  getConnectionStatus(composioAccountId: string): Promise<ConnectorStatus>;
  /**
   * Verifies an inbound Composio webhook's signature and, if it's a
   * connected-account status event, normalizes it into a
   * `ConnectorWebhookEvent`.
   *
   * - Throws only when the signature itself is invalid (or verification
   *   otherwise fails) — callers must map that, and only that, to a 401.
   * - Returns `null` when the signature is valid but the payload isn't a
   *   connected-account event this gateway understands (e.g. a trigger
   *   webhook, or a future event shape) — callers must ack it as a no-op,
   *   never as an auth failure, so Composio doesn't mistake a legitimate
   *   delivery for a broken subscription and back off/disable it.
   */
  verifyWebhook(
    rawBody: Buffer | string,
    headers: ConnectorWebhookHeaders,
  ): Promise<ConnectorWebhookEvent | null>;
  /**
   * Tells Composio to delete the connected account, revoking its access.
   */
  revoke(composioAccountId: string): Promise<void>;
}
