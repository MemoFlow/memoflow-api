import { EmailMessage } from '../../domain/email/email-sender.port';

function joinUrl(baseUrl: string, path: string, token: string): string {
  // The token goes in the fragment so it never reaches server access logs.
  return `${baseUrl.replace(/\/+$/, '')}${path}#token=${token}`;
}

export function buildResetLink(baseUrl: string, token: string): string {
  return joinUrl(baseUrl, '/reset-password', token);
}

export function buildVerifyLink(baseUrl: string, token: string): string {
  return joinUrl(baseUrl, '/verify-email', token);
}

export function verificationEmail(to: string, link: string): EmailMessage {
  return {
    to,
    subject: 'Verify your MemoFlow email',
    text: [
      'Welcome to MemoFlow.',
      '',
      'Confirm your email address by opening this link (valid for 24 hours):',
      link,
      '',
      "If you didn't create this account, ignore this email and the address will stay unverified.",
    ].join('\n'),
  };
}

export function passwordResetEmail(to: string, link: string): EmailMessage {
  return {
    to,
    subject: 'Reset your MemoFlow password',
    text: [
      'We received a request to reset your MemoFlow password.',
      '',
      'Choose a new password by opening this link (valid for 1 hour):',
      link,
      '',
      'If you did not ask for this, you can ignore this message.',
    ].join('\n'),
  };
}

export function existingAccountEmail(to: string, link: string): EmailMessage {
  return {
    to,
    subject: 'You already have a MemoFlow account',
    text: [
      'Someone tried to sign up for MemoFlow with this email address, but an account already exists.',
      '',
      'If it was you, you can log in as usual, or reset your password here (valid for 1 hour):',
      link,
      '',
      'If it was not you, you can ignore this message.',
    ].join('\n'),
  };
}
