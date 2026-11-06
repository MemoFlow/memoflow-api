import * as Sentry from '@sentry/nestjs';

/**
 * Parses `SENTRY_TRACES_SAMPLE_RATE` off raw `process.env` (this module runs
 * before env.validation.ts's class-validator pass, which normally guards the
 * [0,1] range) — defensively clamps a missing/non-numeric/out-of-range value
 * back to `0` (errors-only) rather than handing `Sentry.init` a `NaN` or an
 * invalid sampling probability.
 */
export function parseSentryTracesSampleRate(value: unknown): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

/**
 * Removes request bodies, cookies, credential headers and query strings from
 * an event before it leaves the process, for every route. Request bodies
 * carry passwords and one-time tokens, and URLs may carry query secrets.
 */
export function scrubSentryEvent<T extends Sentry.Event>(event: T): T {
  const request = event.request;
  if (!request) return event;
  delete request.data;
  delete request.cookies;
  delete request.query_string;
  if (request.headers) {
    for (const name of Object.keys(request.headers)) {
      const lower = name.toLowerCase();
      if (lower === 'authorization' || lower === 'cookie') {
        delete request.headers[name];
      }
    }
  }
  if (typeof request.url === 'string') {
    request.url = request.url.split('?')[0].split('#')[0];
  }
  return event;
}

// Optional, OFF by default (mirrors the ANTHROPIC_API_KEY convention):
// SENTRY_DSN unset means Sentry is a complete no-op and the app boots
// identically — this is what keeps start:dev, unit tests, e2e
// (Testcontainers), and smoke working with zero Sentry config. Reads
// process.env directly rather than ConfigService: this module is imported
// as the very first line of main.ts, before Nest's DI container (and
// therefore ConfigService) exists — same rationale as
// planning.gateway.ts reading WS_CORS_ORIGIN off process.env.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    // Errors-only for this slice: no performance/tracing data is sent
    // unless explicitly opted into via SENTRY_TRACES_SAMPLE_RATE.
    // Never capture request bodies (the SDK's default is a size-capped
    // "medium" body), and scrub whatever else could carry secrets.
    integrations: [
      Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' }),
    ],
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent,
    tracesSampleRate: parseSentryTracesSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
    ),
  });
}
