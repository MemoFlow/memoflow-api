import type { ConnectorConnectionRepository } from '../connectors/connector-connection.repository';
import type { ConnectorMcpReference } from '../connectors/connector-gateway.port';

/**
 * Resolves a planning job's requested connector names down to the
 * `ConnectorMcpReference`s the external context engine understands — only
 * **active** connections the requesting connector name actually matches,
 * each carrying its Composio account id. Shared by both context-gather
 * transports: the legacy synchronous HTTP path (`ContextEngineHttpClient`)
 * and the RabbitMQ queue-transport publish step
 * (`ProcessPlanningJobUseCase`'s transport branch) — a single place decides
 * which connectors travel to the CE, so the two transports can never drift.
 *
 * A requested connector that isn't an active connection, or an active row
 * missing its `composioAccountId` (a data-integrity edge case — active rows
 * should always carry one), is silently skipped rather than sent as a
 * broken/absent reference.
 */
export async function resolveActiveConnectorReferences(
  connectorConnectionRepository: ConnectorConnectionRepository,
  userId: string,
  requestedConnectors: string[],
): Promise<ConnectorMcpReference[]> {
  const active = await connectorConnectionRepository.findActiveByUser(userId);

  const references: ConnectorMcpReference[] = [];
  for (const connector of requestedConnectors) {
    const row = active.find((c) => (c.provider as string) === connector);
    if (!row || !row.composioAccountId) continue;
    references.push({
      provider: row.provider,
      mcpUrl: null,
      composioAccountId: row.composioAccountId,
    });
  }
  return references;
}
