import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_PASSWORD_RESET_REQUESTED_EVENT } from '../../domain/audit/audit-events';
import type { AuthAccountEventPayload } from '../../domain/audit/audit-events';
import {
  AUTH_TOKEN_MIN_INTERVAL_MS,
  AUTH_TOKEN_TTL_MS,
  AuthTokenType,
  generateAuthToken,
  hashAuthToken,
} from '../../domain/auth/auth-token';
import { AUTH_TOKEN_REPOSITORY } from '../../domain/auth/auth-token.repository';
import type { AuthTokenRepository } from '../../domain/auth/auth-token.repository';
import type { ResetLinkReason } from '../../domain/auth/auth-events';
import { EMAIL_SENDER } from '../../domain/email/email-sender.port';
import type { EmailSender } from '../../domain/email/email-sender.port';
import { normalizeEmail } from '../../domain/users/normalize-email';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';
import {
  buildResetLink,
  existingAccountEmail,
  passwordResetEmail,
} from './auth-emails';
import { AUTH_MAIL_CONFIG } from './auth-mail-config.token';
import type { AuthMailConfig } from './auth-mail-config.token';

export interface SendPasswordResetEmailInput {
  email: string;
  reason: ResetLinkReason;
}

/**
 * Looks the account up, issues a password-reset token and mails the link.
 * Runs off the request path (from a listener), so none of its work is
 * observable by the caller. Silently does nothing for unknown or disabled
 * accounts, inside the per-account issue limit, or with no base URL.
 */
@Injectable()
export class SendPasswordResetEmailUseCase {
  private readonly logger = new Logger(SendPasswordResetEmailUseCase.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    @Inject(AUTH_TOKEN_REPOSITORY)
    private readonly authTokenRepository: AuthTokenRepository,
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSender,
    @Inject(AUTH_MAIL_CONFIG)
    private readonly config: AuthMailConfig,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: SendPasswordResetEmailInput): Promise<void> {
    const user = await this.userRepository.findByEmail(
      normalizeEmail(input.email),
    );
    if (!user || user.isDisabled) return;

    if (!this.config.appBaseUrl) {
      this.logger.log('APP_BASE_URL not set; skipped password reset email');
      return;
    }

    const token = generateAuthToken();
    const issued = await this.authTokenRepository.issue({
      userId: user.id,
      type: AuthTokenType.PasswordReset,
      tokenHash: hashAuthToken(token),
      expiresAt: new Date(
        Date.now() + AUTH_TOKEN_TTL_MS[AuthTokenType.PasswordReset],
      ),
      minIntervalMs: AUTH_TOKEN_MIN_INTERVAL_MS,
    });
    if (!issued) return;

    const link = buildResetLink(this.config.appBaseUrl, token);
    await this.emailSender.send(
      input.reason === 'existing_account'
        ? existingAccountEmail(user.email, link)
        : passwordResetEmail(user.email, link),
    );

    const audit: AuthAccountEventPayload = { userId: user.id };
    this.eventEmitter.emit(AUTH_PASSWORD_RESET_REQUESTED_EVENT, audit);
  }
}
