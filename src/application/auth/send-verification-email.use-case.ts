import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AUTH_TOKEN_MIN_INTERVAL_MS,
  AUTH_TOKEN_TTL_MS,
  AuthTokenType,
  generateAuthToken,
  hashAuthToken,
} from '../../domain/auth/auth-token';
import { AUTH_TOKEN_REPOSITORY } from '../../domain/auth/auth-token.repository';
import type { AuthTokenRepository } from '../../domain/auth/auth-token.repository';
import { EMAIL_SENDER } from '../../domain/email/email-sender.port';
import type { EmailSender } from '../../domain/email/email-sender.port';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';
import { buildVerifyLink, verificationEmail } from './auth-emails';
import { AUTH_MAIL_CONFIG } from './auth-mail-config.token';
import type { AuthMailConfig } from './auth-mail-config.token';

/**
 * Issues an email-verification token and mails the link. Runs off the request
 * path (from a listener). Silently does nothing for unknown, disabled or
 * already-verified accounts, inside the per-account issue limit, or when no
 * base URL is configured.
 */
@Injectable()
export class SendVerificationEmailUseCase {
  private readonly logger = new Logger(SendVerificationEmailUseCase.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    @Inject(AUTH_TOKEN_REPOSITORY)
    private readonly authTokenRepository: AuthTokenRepository,
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSender,
    @Inject(AUTH_MAIL_CONFIG)
    private readonly config: AuthMailConfig,
  ) {}

  async execute(userId: string): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user || user.isDisabled || user.isEmailVerified) return;

    if (!this.config.appBaseUrl) {
      this.logger.log('APP_BASE_URL not set; skipped verification email');
      return;
    }

    const token = generateAuthToken();
    const issued = await this.authTokenRepository.issue({
      userId: user.id,
      type: AuthTokenType.EmailVerification,
      tokenHash: hashAuthToken(token),
      expiresAt: new Date(
        Date.now() + AUTH_TOKEN_TTL_MS[AuthTokenType.EmailVerification],
      ),
      minIntervalMs: AUTH_TOKEN_MIN_INTERVAL_MS,
    });
    if (!issued) return;

    await this.emailSender.send(
      verificationEmail(
        user.email,
        buildVerifyLink(this.config.appBaseUrl, token),
      ),
    );
  }
}
