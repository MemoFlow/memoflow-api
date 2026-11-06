/**
 * Emitted after a connector connection's status really changed (webhook, poll
 * reconcile, or a reconnect that resets the row to `initiated`). Consumed by
 * the lead-scoring listener.
 */
export const CONNECTOR_STATUS_CHANGED_EVENT = 'connector.status_changed';

export interface ConnectorStatusChangedEventPayload {
  userId: string;
}
