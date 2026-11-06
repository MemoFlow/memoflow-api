import {
  EmailMessage,
  EmailSender,
} from '../../domain/email/email-sender.port';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * `EmailSender` backed by Resend's REST API, called with the global `fetch`
 * (no SDK dependency). Failures throw an error carrying only the HTTP status,
 * never the API key, the recipient or the message body.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Email provider request failed: ${response.status}`);
    }
  }
}
