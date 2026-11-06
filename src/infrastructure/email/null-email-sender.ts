import { Logger } from '@nestjs/common';
import {
  EmailMessage,
  EmailSender,
} from '../../domain/email/email-sender.port';

/**
 * Used when no email provider is configured (development/test). Logs only
 * the subject (the message's kind), never the recipient, token or link.
 */
export class NullEmailSender implements EmailSender {
  private readonly logger = new Logger(NullEmailSender.name);

  send(message: EmailMessage): Promise<void> {
    this.logger.log(
      `Email provider not configured; skipped message "${message.subject}"`,
    );
    return Promise.resolve();
  }
}
