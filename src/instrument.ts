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
    tracesSampleRate: parseSentryTracesSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
    ),
  });
}
