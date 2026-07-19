import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { HandleGamificationEventUseCase } from '../../application/gamification/handle-gamification-event.use-case';
import type { GamificationEventPayload } from '../../application/gamification/gamification-event';
import {
  DOCUMENT_CREATED_EVENT,
  SECTION_CREATED_EVENT,
  SECTION_UPDATED_EVENT,
} from '../../domain/documents/document-events';
import type {
  DocumentCreatedEventPayload,
  SectionCreatedEventPayload,
  SectionUpdatedEventPayload,
} from '../../domain/documents/document-events';

/**
 * Subscribes to the documents feature's domain events and delegates to
 * `HandleGamificationEventUseCase`. Transport-edge only — mirrors
 * `PlanningGateway`'s `@OnEvent` relays: this is the ONLY place gamification
 * events are consumed, and the ONLY place their errors are swallowed. A
 * gamification failure (e.g. a transient DB error) must never fail the
 * request that emitted the originating event — `EventEmitter2.emit()` is
 * fire-and-forget and doesn't await these handlers, so an uncaught rejection
 * here would only ever surface as an unhandled rejection, not a failed
 * request; catching it here turns that into a clean log line instead.
 */
@Injectable()
export class GamificationListener {
  private readonly logger = new Logger(GamificationListener.name);

  constructor(
    private readonly handleGamificationEvent: HandleGamificationEventUseCase,
  ) {}

  @OnEvent(DOCUMENT_CREATED_EVENT)
  async onDocumentCreated(payload: DocumentCreatedEventPayload): Promise<void> {
    await this.safeHandle(DOCUMENT_CREATED_EVENT, payload);
  }

  @OnEvent(SECTION_CREATED_EVENT)
  async onSectionCreated(payload: SectionCreatedEventPayload): Promise<void> {
    await this.safeHandle(SECTION_CREATED_EVENT, payload);
  }

  @OnEvent(SECTION_UPDATED_EVENT)
  async onSectionUpdated(payload: SectionUpdatedEventPayload): Promise<void> {
    await this.safeHandle(SECTION_UPDATED_EVENT, payload);
  }

  private async safeHandle(
    event: string,
    payload: GamificationEventPayload,
  ): Promise<void> {
    try {
      await this.handleGamificationEvent.execute(event, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(
        `Gamification handling failed for '${event}' (userId=${payload.userId}, documentId=${payload.documentId}): ${message}`,
      );
    }
  }
}
