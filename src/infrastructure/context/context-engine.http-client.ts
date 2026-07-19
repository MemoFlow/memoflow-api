import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONNECTOR_CONNECTION_REPOSITORY } from '../../domain/connectors/connector-connection.repository';
import type { ConnectorConnectionRepository } from '../../domain/connectors/connector-connection.repository';
import { ContextEnginePort } from '../../domain/context/context-engine.port';
import type { GatherContextInput } from '../../domain/context/context-engine.port';
import { resolveActiveConnectorReferences } from '../../domain/context/resolve-connector-references';

/** Default `fetch` timeout for the context-engine POST, overridable via
 * `CONTEXT_ENGINE_TIMEOUT_MS`. */
const DEFAULT_CONTEXT_ENGINE_TIMEOUT_MS = 10_000;

/**
 * `ContextEnginePort` implementation that pushes a user's active, requested
 * connectors (+ their Composio MCP references) to the external context
 * engine over HTTP and returns whatever context payload it computes.
 *
 * MCP references are built directly from the `ConnectorConnection` rows
 * already loaded from `findActiveByUser` — `composioAccountId` lives on that
 * row, so there's no extra Composio round trip per connector (and `mcpUrl`
 * is always `null`; see `ConnectorMcpReference`'s doc comment).
 *
 * Uses Node's global `fetch` (Node >= 18) — no new HTTP client dependency.
 */
@Injectable()
export class ContextEngineHttpClient implements ContextEnginePort {
  constructor(
    @Inject(CONNECTOR_CONNECTION_REPOSITORY)
    private readonly connectorConnectionRepository: ConnectorConnectionRepository,
    private readonly config: ConfigService,
  ) {}

  async gatherContext(
    input: GatherContextInput,
  ): Promise<Record<string, unknown>> {
    const connectors = await resolveActiveConnectorReferences(
      this.connectorConnectionRepository,
      input.userId,
      input.connectors,
    );

    const url = this.config.getOrThrow<string>('CONTEXT_ENGINE_URL');
    const apiKey = this.config.get<string>('CONTEXT_ENGINE_API_KEY');
    const timeoutMs =
      this.config.get<number>('CONTEXT_ENGINE_TIMEOUT_MS') ??
      DEFAULT_CONTEXT_ENGINE_TIMEOUT_MS;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId: input.userId,
        connectors,
        prompt: input.prompt,
      }),
      // A hung context engine must not stall the in-process worker
      // indefinitely — an aborted/timed-out fetch rejects, which propagates
      // to ProcessPlanningJobUseCase's catch and records the job `failed`.
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `Context engine request failed: ${response.status} ${response.statusText}`,
      );
    }

    try {
      return (await response.json()) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        'Context engine returned an invalid response (expected JSON)',
        { cause: err },
      );
    }
  }
}
