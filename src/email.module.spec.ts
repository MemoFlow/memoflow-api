import { ConfigService } from '@nestjs/config';
import { emailSenderFactory } from './email.module';
import { NullEmailSender } from './infrastructure/email/null-email-sender';
import { ResendEmailSender } from './infrastructure/email/resend-email-sender';

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('emailSenderFactory', () => {
  it('uses the null sender without RESEND_API_KEY', () => {
    expect(emailSenderFactory(config({}))).toBeInstanceOf(NullEmailSender);
  });

  it('uses the Resend sender once RESEND_API_KEY is set', () => {
    expect(
      emailSenderFactory(config({ RESEND_API_KEY: 're_key' })),
    ).toBeInstanceOf(ResendEmailSender);
  });
});
