import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { RecalculateLeadScoreUseCase } from '../../application/leads/recalculate-lead-score.use-case';
import { CONNECTOR_REVOKED_EVENT } from '../../domain/audit/audit-events';
import { CONNECTOR_STATUS_CHANGED_EVENT } from '../../domain/connectors/connector-events';
import type { ConnectorStatusChangedEventPayload } from '../../domain/connectors/connector-events';

/**
 * Recalculates a lead's score when one of their connectors changes status.
 * Same contract as `GamificationListener`: this is the only place these
 * errors are swallowed, so a scoring failure never fails the originating
 * request, but it is logged and sent to Sentry.
 */
@Injectable()
export class LeadScoreListener {
  private readonly logger = new Logger(LeadScoreListener.name);

  constructor(private readonly recalculate: RecalculateLeadScoreUseCase) {}

  @OnEvent(CONNECTOR_STATUS_CHANGED_EVENT)
  async onConnectorStatusChanged(
    payload: ConnectorStatusChangedEventPayload,
  ): Promise<void> {
    await this.safeHandle(CONNECTOR_STATUS_CHANGED_EVENT, payload);
  }

  @OnEvent(CONNECTOR_REVOKED_EVENT)
  async onConnectorRevoked(
    payload: ConnectorStatusChangedEventPayload,
  ): Promise<void> {
    await this.safeHandle(CONNECTOR_REVOKED_EVENT, payload);
  }

  private async safeHandle(
    event: string,
    payload: ConnectorStatusChangedEventPayload,
  ): Promise<void> {
    try {
      await this.recalculate.execute(payload.userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(
        `Lead score recalculation failed for '${event}' (userId=${payload.userId}): ${message}`,
      );
      Sentry.captureException(err);
    }
  }
}
