import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { SendPasswordResetEmailUseCase } from '../../application/auth/send-password-reset-email.use-case';
import { SendVerificationEmailUseCase } from '../../application/auth/send-verification-email.use-case';
import {
  AUTH_RESET_LINK_REQUESTED_EVENT,
  AUTH_VERIFICATION_REQUESTED_EVENT,
} from '../../domain/auth/auth-events';
import type {
  AuthResetLinkRequestedEventPayload,
  AuthVerificationRequestedEventPayload,
} from '../../domain/auth/auth-events';

/**
 * Sends auth emails off the request path. Like `GamificationListener`, this
 * is the only place these events are consumed and the only place their
 * errors are swallowed: a mail failure must never fail the request, and the
 * log line deliberately carries no address, token or link.
 */
@Injectable()
export class AuthMailListener {
  private readonly logger = new Logger(AuthMailListener.name);

  constructor(
    private readonly sendVerificationEmail: SendVerificationEmailUseCase,
    private readonly sendPasswordResetEmail: SendPasswordResetEmailUseCase,
  ) {}

  @OnEvent(AUTH_VERIFICATION_REQUESTED_EVENT)
  async onVerificationRequested(
    payload: AuthVerificationRequestedEventPayload,
  ): Promise<void> {
    await this.safe(AUTH_VERIFICATION_REQUESTED_EVENT, () =>
      this.sendVerificationEmail.execute(payload.userId),
    );
  }

  @OnEvent(AUTH_RESET_LINK_REQUESTED_EVENT)
  async onResetLinkRequested(
    payload: AuthResetLinkRequestedEventPayload,
  ): Promise<void> {
    await this.safe(AUTH_RESET_LINK_REQUESTED_EVENT, () =>
      this.sendPasswordResetEmail.execute(payload),
    );
  }

  private async safe(event: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(
        `Auth email handling failed for '${event}': ${message}`,
      );
      Sentry.captureException(err);
    }
  }
}
