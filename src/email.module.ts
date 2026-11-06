import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_SENDER, EmailSender } from './domain/email/email-sender.port';
import { NullEmailSender } from './infrastructure/email/null-email-sender';
import { ResendEmailSender } from './infrastructure/email/resend-email-sender';

/** Used when `RESEND_API_KEY` is set but `EMAIL_FROM` is not (dev only). */
const DEFAULT_FROM = 'MemoFlow <onboarding@resend.dev>';

/**
 * Picks the Resend adapter once `RESEND_API_KEY` is configured and falls back
 * to `NullEmailSender` otherwise, so dev/test run with no mail provider.
 * Same style as `suggestionGeneratorFactory`.
 */
export function emailSenderFactory(config: ConfigService): EmailSender {
  const apiKey = config.get<string>('RESEND_API_KEY');
  return apiKey
    ? new ResendEmailSender(
        apiKey,
        config.get<string>('EMAIL_FROM') || DEFAULT_FROM,
      )
    : new NullEmailSender();
}

@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService],
      useFactory: emailSenderFactory,
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
