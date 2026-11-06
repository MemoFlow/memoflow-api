export const EMAIL_SENDER = Symbol('EmailSender');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Outbound transactional email. Implementations throw when delivery fails. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
