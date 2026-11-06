import { Logger } from '@nestjs/common';
import { NullEmailSender } from './null-email-sender';

describe('NullEmailSender', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves and logs only the message kind, never recipient or body', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    await new NullEmailSender().send({
      to: 'ada@example.com',
      subject: 'Reset your MemoFlow password',
      text: 'https://app/reset-password#token=abc',
    });

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain('Reset your MemoFlow password');
    expect(line).not.toContain('ada@example.com');
    expect(line).not.toContain('token=abc');
  });
});
