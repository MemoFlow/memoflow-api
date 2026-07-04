import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConnectorConnection } from '../../domain/connectors/connector-connection.entity';
import {
  CONNECTOR_CONNECTION_REPOSITORY,
  UpdateConnectorStatusData,
} from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { CONNECTOR_GATEWAY } from '../../domain/connectors/connector-gateway.port';
import type {
  ConnectorGateway,
  ConnectorWebhookEvent,
  ConnectorWebhookHeaders,
} from '../../domain/connectors/connector-gateway.port';
import { ConnectorStatus } from '../../domain/connectors/connector-status';

/**
 * Terminal states a connection can only leave via a fresh connect
 * (`upsertInitiated`) — never via a webhook or poll reconcile. Without this
 * guard, a stale/retried Composio `ACTIVE` webhook arriving after a
 * user-initiated revoke would silently resurrect the connection.
 */
const TERMINAL_STATUSES: ReadonlySet<ConnectorStatus> = new Set([
  ConnectorStatus.Revoked,
  ConnectorStatus.Failed,
]);

/**
 * Truncates a Composio account id for logging — enough to correlate
 * log lines with a specific account without writing the full reference id
 * to logs in full.
 */
function redactAccountId(composioAccountId: string): string {
  return `${composioAccountId.slice(0, 8)}…`;
}

/**
 * Keeps a `connector_connections` row's status in sync with Composio via two
 * paths, both idempotent:
 * - `applyEvent` — driven by the `/connectors/webhook` Composio callback.
 * - `reconcile` — poll fallback invoked on read (`GetConnectionUseCase` /
 *   `ListConnectionsUseCase`), only for rows still `Initiated` (Composio's
 *   one non-terminal state) — active/revoked/failed rows are already
 *   settled and never trigger a Composio call.
 *
 * Both paths funnel status changes through `applyStatus`, which refuses any
 * transition out of a terminal state (`Revoked`/`Failed`).
 */
@Injectable()
export class SyncConnectionStatusUseCase {
  private readonly logger = new Logger(SyncConnectionStatusUseCase.name);

  constructor(
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository: ConnectorConnectionRepository,
    @Inject(CONNECTOR_GATEWAY)
    private readonly connectorGateway: ConnectorGateway,
  ) {}

  /**
   * Applies a webhook-delivered status change. Unknown Composio accounts
   * (e.g. a stale/replayed webhook, or an account created outside this API)
   * no-op rather than throw — webhooks must ack with 200 regardless.
   */
  async applyEvent(event: ConnectorWebhookEvent): Promise<void> {
    const connection =
      await this.connectorConnectionRepository.findByComposioAccountId(
        event.composioAccountId,
      );
    if (!connection) {
      this.logger.debug(
        `Ignoring webhook for unknown Composio account ${redactAccountId(event.composioAccountId)}`,
      );
      return;
    }
    await this.applyStatus(connection, event.status);
  }

  /**
   * Verifies an inbound webhook's signature and applies it.
   *
   * - A genuine signature failure becomes an `UnauthorizedException` so the
   *   controller responds 401.
   * - A validly-signed payload that isn't a connected-account event
   *   (`gateway.verifyWebhook` returns `null`) is acked as a no-op — it is
   *   NOT an auth failure, and must not be reported as one.
   */
  async verifyAndApply(
    rawBody: Buffer | string,
    headers: ConnectorWebhookHeaders,
  ): Promise<void> {
    let event: ConnectorWebhookEvent | null;
    try {
      event = await this.connectorGateway.verifyWebhook(rawBody, headers);
    } catch {
      throw new UnauthorizedException('Invalid Composio webhook signature');
    }

    if (!event) {
      this.logger.debug(
        'Ignoring non-connection Composio webhook event (valid signature, unrecognized payload shape)',
      );
      return;
    }

    await this.applyEvent(event);
  }

  /**
   * Poll fallback: only `Initiated` connections are non-terminal, so only
   * they ever trigger a Composio status lookup. Terminal statuses
   * (active/revoked/failed) are returned unchanged.
   *
   * Never throws: a Composio outage/rate-limit during the lookup falls back
   * to the last-known local status rather than failing the caller's read.
   */
  async reconcile(
    connection: ConnectorConnection,
  ): Promise<ConnectorConnection> {
    if (
      connection.status !== ConnectorStatus.Initiated ||
      !connection.composioAccountId
    ) {
      return connection;
    }

    let status: ConnectorStatus;
    try {
      status = await this.connectorGateway.getConnectionStatus(
        connection.composioAccountId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Reconcile failed for connection ${connection.id} — Composio lookup errored (${message}); falling back to the last-known local status "${connection.status}"`,
      );
      return connection;
    }

    if (status === connection.status) {
      return connection;
    }
    return this.applyStatus(connection, status);
  }

  private async applyStatus(
    connection: ConnectorConnection,
    status: ConnectorStatus,
  ): Promise<ConnectorConnection> {
    if (connection.status === status) {
      // Idempotent: nothing changed (e.g. a duplicate webhook delivery).
      return connection;
    }

    if (TERMINAL_STATUSES.has(connection.status)) {
      // A terminal connection (Revoked/Failed) may only leave that state via
      // a fresh connect (`upsertInitiated`) — never via a webhook or poll
      // reconcile. Otherwise a stale/retried `ACTIVE` webhook arriving after
      // a user-initiated revoke would silently undo it.
      this.logger.debug(
        `Ignoring status transition for terminal connection ${connection.id}: ${connection.status} -> ${status}`,
      );
      return connection;
    }

    const patch: UpdateConnectorStatusData = { status };
    if (status === ConnectorStatus.Active && !connection.connectedAt) {
      patch.connectedAt = new Date();
    }

    const updated = await this.connectorConnectionRepository.updateStatus(
      connection.id,
      patch,
    );
    return updated ?? connection;
  }
}
