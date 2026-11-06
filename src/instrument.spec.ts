import type { ErrorEvent, Event } from '@sentry/nestjs';
import { scrubSentryEvent } from './instrument';

describe('scrubSentryEvent', () => {
  function makeEvent(): ErrorEvent {
    return {
      type: undefined,
      request: {
        url: 'https://api.example.com/auth/reset-password?token=abc&x=1#frag',
        query_string: 'token=abc&x=1',
        cookies: { session: 'secret' },
        data: {
          token: 'raw-token',
          new_password: 'np',
          current_password: 'cp',
          password: 'pw',
        },
        headers: {
          Authorization: 'Bearer jwt',
          cookie: 'session=secret',
          'content-type': 'application/json',
        },
      },
    };
  }

  it('removes the body, cookies, credential headers and query string', () => {
    const event = scrubSentryEvent(makeEvent());

    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.url).toBe(
      'https://api.example.com/auth/reset-password',
    );
    expect(event.request?.headers).toEqual({
      'content-type': 'application/json',
    });
    const serialized = JSON.stringify(event);
    for (const secret of ['raw-token', 'np', '"cp"', 'pw', 'jwt', 'secret']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('passes through an event without a request', () => {
    const event = { type: undefined } as ErrorEvent;
    expect(scrubSentryEvent(event)).toBe(event);
  });

  it('scrubs transaction events the same way', () => {
    const tx = {
      type: 'transaction',
      request: {
        url: 'https://api.example.com/x?token=abc',
        query_string: 'token=abc',
        headers: { authorization: 'Bearer jwt' },
      },
    } as Event;

    const event = scrubSentryEvent(tx);

    expect(event.request?.url).toBe('https://api.example.com/x');
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.headers).toEqual({});
  });
});
