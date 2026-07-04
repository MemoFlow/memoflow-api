import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// Type-only import — erased at compile time, so this does not pull the ESM
// runtime module into a CommonJS `require`. The runtime class is loaded via
// a cached dynamic `import()` below (see `getClient`).
import type { Composio as ComposioClient } from '@composio/core';
import {
  ConnectorGateway,
  ConnectorWebhookEvent,
  ConnectorWebhookHeaders,
  InitiateConnectionInput,
  InitiateConnectionResult,
} from '../../domain/connectors/connector-gateway.port';
import { ConnectorStatus } from '../../domain/connectors/connector-status';
import { parseComposioAuthConfigIds } from '../../config/env.validation';

/**
 * `@composio/core` is ESM-only; this project compiles to CommonJS. A static
 * `import { Composio } from '@composio/core'` would fail at runtime under
 * `require()`, so the client class is loaded lazily via dynamic `import()`
 * (which Node's CommonJS loader supports natively) and memoized so it only
 * happens once per process.
 */
@Injectable()
export class ComposioGateway implements ConnectorGateway {
  private clientPromise: Promise<ComposioClient> | null = null;
  private authConfigIds: Record<string, string> | null = null;

  constructor(private readonly config: ConfigService) {}

  async initiateConnection(
    input: InitiateConnectionInput,
  ): Promise<InitiateConnectionResult> {
    const client = await this.getClient();
    const authConfigId = this.resolveAuthConfigId(input.provider);

    // `connectedAccounts.initiate()` is deprecated (and, for Composio-managed
    // OAuth2, retired outright) as of the 2026 cutover documented on the SDK
    // method itself — `link()` is the supported replacement with the same
    // `ConnectionRequest` return shape (`id`, `redirectUrl`, `status`).
    const connectionRequest = await client.connectedAccounts.link(
      input.userId,
      authConfigId,
    );

    if (!connectionRequest.redirectUrl) {
      throw new ServiceUnavailableException(
        `Composio did not return a redirect URL for provider "${input.provider}"`,
      );
    }

    return {
      redirectUrl: connectionRequest.redirectUrl,
      composioAccountId: connectionRequest.id,
      status: this.mapStatus(connectionRequest.status),
    };
  }

  async getConnectionStatus(
    composioAccountId: string,
  ): Promise<ConnectorStatus> {
    const client = await this.getClient();
    const account = await client.connectedAccounts.get(composioAccountId);
    return this.mapStatus(account.status);
  }

  /**
   * `composio.triggers.verifyWebhook()` is the SDK's one HMAC verification
   * entry point (there is no separate `composio.webhooks` client in
   * 0.13.1) — it signs `${webhook-id}.${webhook-timestamp}.${payload}` and
   * throws `ComposioWebhookSignatureVerificationError` on a mismatch. That
   * call — and only that call — is left uncaught here, so a genuine
   * signature failure propagates to the caller as-is.
   *
   * It normalizes the verified payload into an `IncomingTriggerPayload`
   * (the *trigger-automation* shape — `triggerSlug`/`payload`), which does
   * not carry the connected-account fields (`data.id`, `data.status`) this
   * gateway needs. So once the signature is confirmed authentic, the raw
   * JSON body is parsed directly for that connected-account event shape —
   * the same `{ data: { id, status, ... } }` shape as `GET
   * /connected_accounts/{id}` and the SDK's typed
   * `ConnectionExpiredEventSchema` — which every
   * `composio.connected_account.*` webhook shares.
   *
   * Anything that goes wrong *after* the signature is confirmed valid
   * (malformed JSON, an unrecognized payload shape — e.g. a trigger-message
   * webhook that isn't a connected-account event) returns `null` rather
   * than throwing: it's a "nothing to do here" case, not an auth failure,
   * and must not be reported as one.
   */
  async verifyWebhook(
    rawBody: Buffer | string,
    headers: ConnectorWebhookHeaders,
  ): Promise<ConnectorWebhookEvent | null> {
    const client = await this.getClient();
    const payload = Buffer.isBuffer(rawBody)
      ? rawBody.toString('utf8')
      : rawBody;

    // Only this call can throw ComposioWebhookSignatureVerificationError —
    // left uncaught deliberately.
    await client.triggers.verifyWebhook({
      id: headers.id,
      timestamp: headers.timestamp,
      signature: headers.signature,
      payload,
      secret: this.config.getOrThrow<string>('COMPOSIO_WEBHOOK_SECRET'),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }

    const data = (parsed as { data?: Record<string, unknown> } | null)?.data;
    const composioAccountId = data?.id;
    const status = data?.status;
    if (typeof composioAccountId !== 'string' || typeof status !== 'string') {
      return null;
    }

    return {
      composioAccountId,
      status: this.mapStatus(status),
    };
  }

  async revoke(composioAccountId: string): Promise<void> {
    const client = await this.getClient();
    await client.connectedAccounts.delete(composioAccountId);
  }

  private resolveAuthConfigId(provider: string): string {
    if (!this.authConfigIds) {
      this.authConfigIds = parseComposioAuthConfigIds(
        this.config.getOrThrow<string>('COMPOSIO_AUTH_CONFIG_IDS'),
      );
    }
    const authConfigId = this.authConfigIds[provider];
    if (!authConfigId) {
      throw new ServiceUnavailableException(
        `No Composio auth config id configured for provider "${provider}" ` +
          '(see COMPOSIO_AUTH_CONFIG_IDS)',
      );
    }
    return authConfigId;
  }

  private mapStatus(status: string | undefined): ConnectorStatus {
    switch (status) {
      case 'INITIATED':
      case 'INITIALIZING':
      case 'INITIATING':
        return ConnectorStatus.Initiated;
      case 'ACTIVE':
        return ConnectorStatus.Active;
      case 'FAILED':
        return ConnectorStatus.Failed;
      case 'EXPIRED':
      case 'INACTIVE':
      case 'REVOKED':
        return ConnectorStatus.Revoked;
      default:
        // Fail safe/visible: an unrecognized Composio status (a new/renamed
        // state on their side) must not masquerade as healthy `initiated`
        // progress — a dead connection would then look pending forever.
        return ConnectorStatus.Failed;
    }
  }

  private getClient(): Promise<ComposioClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    return this.clientPromise;
  }

  private async createClient(): Promise<ComposioClient> {
    const { Composio } = await import('@composio/core');
    return new Composio({
      apiKey: this.config.getOrThrow<string>('COMPOSIO_API_KEY'),
      baseURL: this.config.get<string>('COMPOSIO_BASE_URL'),
    });
  }
}
