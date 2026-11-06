import { ResendEmailSender } from './resend-email-sender';

describe('ResendEmailSender', () => {
  const message = {
    to: 'ada@example.com',
    subject: 'Subject line',
    text: 'secret body with a link',
  };
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POSTs the message to Resend with a bearer key and a timeout signal', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const sender = new ResendEmailSender('re_secret_key', 'MemoFlow <a@b.dev>');

    await sender.send(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer re_secret_key',
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'MemoFlow <a@b.dev>',
      to: ['ada@example.com'],
      subject: 'Subject line',
      text: 'secret body with a link',
    });
  });

  it('includes html only when provided', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const sender = new ResendEmailSender('k', 'from@x.dev');

    await sender.send({ ...message, html: '<p>hi</p>' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).html).toBe('<p>hi</p>');
  });

  it('throws on a non-2xx response without leaking the key, recipient or body', async () => {
    fetchMock.mockResolvedValue(
      new Response('echo re_secret_key secret body with a link', {
        status: 422,
      }),
    );
    const sender = new ResendEmailSender('re_secret_key', 'from@x.dev');

    const error = await sender.send(message).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    const text = (error as Error).message;
    expect(text).toContain('422');
    expect(text).not.toContain('re_secret_key');
    expect(text).not.toContain('ada@example.com');
    expect(text).not.toContain('secret body');
  });
});
