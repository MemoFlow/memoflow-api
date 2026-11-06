import { Transform, plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsUrl,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import {
  parsePostgresSsl,
  parsePostgresSslRejectUnauthorized,
  postgresSslTierViolation,
} from './postgres-ssl';
import { Logger } from '@nestjs/common';

export const NODE_ENVS = [
  'development',
  'staging',
  'production',
  'test',
] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export { parsePostgresSsl, parsePostgresSslRejectUnauthorized };

/**
 * Case-insensitive "true" check for REDIS_TLS, mirroring parsePostgresSsl so
 * both toggles behave identically for local docker (plaintext) vs managed
 * TLS-only providers (e.g. Upstash).
 */
export function parseRedisTls(value: unknown): boolean {
  return String(value).toLowerCase() === 'true';
}

/**
 * Parses `COMPOSIO_AUTH_CONFIG_IDS` — a comma-separated `provider:authConfigId`
 * map, e.g. `trello:ac_123,notion:ac_456,github:ac_789` — into a lookup
 * record. Shared between the runtime config and `ComposioGateway`, which
 * resolves a specific provider's auth config id at call time and throws a
 * clear error if that provider has no configured id.
 */
export function parseComposioAuthConfigIds(
  value: unknown,
): Record<string, string> {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return {};

  const map: Record<string, string> = {};
  for (const pair of raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)) {
    const parts = pair.split(':').map((s) => s.trim());
    // Exactly two non-empty parts: reject both "notion" (missing id) and
    // "trello:ac:123" (stray colon) so a copy-paste typo fails loudly rather
    // than silently truncating to a wrong-but-plausible auth config id.
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `Invalid COMPOSIO_AUTH_CONFIG_IDS entry "${pair}" — expected "provider:authConfigId"`,
      );
    }
    const [provider, authConfigId] = parts;
    if (Object.prototype.hasOwnProperty.call(map, provider)) {
      throw new Error(
        `Duplicate COMPOSIO_AUTH_CONFIG_IDS provider "${provider}"`,
      );
    }
    map[provider] = authConfigId;
  }

  return map;
}

/** Blank or whitespace-only values (e.g. `KEY=` in .env) count as unset. */
export function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/**
 * APP_BASE_URL is the origin (plus optional path prefix) that email links are
 * appended to, so it must not carry credentials, a query string or a fragment.
 */
@ValidatorConstraint({ name: 'appBaseUrl', async: false })
export class AppBaseUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    if (value.includes('?') || value.includes('#')) return false;
    try {
      const url = new URL(value);
      return url.username === '' && url.password === '';
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'APP_BASE_URL must not contain credentials, a query string or a fragment';
  }
}

/** Case-insensitive "true" check for EMAIL_VERIFICATION_REQUIRED. */
export function parseEmailVerificationRequired(value: unknown): boolean {
  return String(value).toLowerCase() === 'true';
}

/** The `JWT_SECRET` shipped in `.env.example`; must never reach a deployed tier. */
export const JWT_SECRET_PLACEHOLDER =
  'dev-only-change-me-to-a-32char-min-random-secret';

export class EnvironmentVariables {
  @IsOptional()
  @IsIn(NODE_ENVS)
  NODE_ENV: NodeEnv = 'development';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  MONGODB_URI: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_HOST: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  POSTGRES_PORT: number;

  @IsString()
  @IsNotEmpty()
  POSTGRES_USER: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_DB: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    parsePostgresSsl(obj.POSTGRES_SSL),
  )
  POSTGRES_SSL: boolean = false;

  /**
   * Verify the Postgres server certificate (default true). Escape hatch for
   * a private-CA database on development only; boot fails on staging and
   * production if this is false.
   */
  @IsOptional()
  @IsBoolean({
    message:
      "POSTGRES_SSL_REJECT_UNAUTHORIZED must be 'true' or 'false' (or unset)",
  })
  @Transform(({ obj }: { obj: Record<string, unknown> }) => {
    try {
      return parsePostgresSslRejectUnauthorized(
        obj.POSTGRES_SSL_REJECT_UNAUTHORIZED,
      );
    } catch {
      // Keep the raw value so @IsBoolean rejects it on every tier.
      return obj.POSTGRES_SSL_REJECT_UNAUTHORIZED;
    }
  })
  POSTGRES_SSL_REJECT_UNAUTHORIZED: boolean = true;

  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN: string = '15m';

  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    parseRedisTls(obj.REDIS_TLS),
  )
  REDIS_TLS: boolean = false;

  // Global rate-limit window (milliseconds) and max requests per window —
  // optional, permissive defaults. The tighter per-route @Throttle on the
  // auth and AI endpoints sits under these. See
  // src/shared/throttler/throttler.module.ts.
  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_TTL: number = 60_000;

  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number = 100;

  // Dev default '*' is convenient locally but unsafe beyond it — staging and
  // production must set this explicitly to the real frontend origin.
  @IsOptional()
  @IsString()
  WS_CORS_ORIGIN: string = '*';

  // REST API CORS. Dev default '*' is convenient locally but unsafe beyond it —
  // staging and production must set the real frontend origin explicitly
  // (mirrors WS_CORS_ORIGIN).
  @IsOptional()
  @IsString()
  CORS_ORIGIN: string = '*';

  @IsString()
  @IsNotEmpty()
  COMPOSIO_API_KEY: string;

  @IsOptional()
  @IsString()
  COMPOSIO_BASE_URL?: string;

  // Comma-separated `provider:authConfigId` map, e.g.
  // `trello:ac_123,notion:ac_456,github:ac_789` — parsed by
  // `parseComposioAuthConfigIds` / `ComposioGateway`.
  @IsString()
  @IsNotEmpty()
  COMPOSIO_AUTH_CONFIG_IDS: string;

  // Secret used to verify the HMAC signature on inbound
  // `POST /connectors/webhook` calls (`ComposioGateway.verifyWebhook`).
  // From the Composio dashboard's webhook subscription config — never
  // hardcoded.
  @IsString()
  @IsNotEmpty()
  COMPOSIO_WEBHOOK_SECRET: string;

  // Base URL of the external context engine that `ContextEngineHttpClient`
  // POSTs a user's active connectors (+ Composio MCP references) and prompt
  // to. Optional: unset in dev/test keeps `ContextModule`'s `CONTEXT_GATHERER`
  // factory on `StubContextGatherer` so no context engine is required to run
  // the app.
  @IsOptional()
  @IsString()
  CONTEXT_ENGINE_URL?: string;

  // Sent as `Authorization: Bearer <key>` on context-engine requests when
  // set. Optional — some deployments may authenticate the context engine by
  // network boundary alone.
  @IsOptional()
  @IsString()
  CONTEXT_ENGINE_API_KEY?: string;

  // Abort the context-engine POST after this many milliseconds so a hung
  // context engine can't stall a planning job's worker indefinitely — the
  // aborted fetch rejects and the job is recorded `failed` via the existing
  // ProcessPlanningJobUseCase error path.
  @IsOptional()
  @IsInt()
  @Min(1)
  CONTEXT_ENGINE_TIMEOUT_MS: number = 10_000;

  // Roadmap item 5 (AI layer). Deliberately OPTIONAL — unlike Composio's
  // required vars, a missing key here must never break boot: `AiModule`'s
  // `SUGGESTION_GENERATOR` provider factory and `ContextModule`'s
  // `LLM_PLANNER` factory both fall back to a null/stub implementation when
  // unset, so `start:dev`/smoke/e2e/tests keep working with no AI provider
  // configured.
  // All LLM calls go through OpenRouter (`OpenRouterGateway`).
  @IsOptional()
  @IsString()
  OPENROUTER_API_KEY?: string;

  @IsOptional()
  @IsString()
  OPENROUTER_MODEL: string = 'openrouter/free';

  // Comma-separated model ids tried after OPENROUTER_MODEL (sent as the
  // OpenRouter `models` array).
  @IsOptional()
  @IsString()
  OPENROUTER_FALLBACK_MODELS?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  OPENROUTER_MAX_TOKENS: number = 4096;

  // Per-request abort timeout so a hung provider can't stall a request.
  @IsOptional()
  @IsInt()
  @Min(1)
  OPENROUTER_TIMEOUT_MS: number = 60_000;

  // Operator config only; overridable so tests can target a fake server.
  @IsOptional()
  @IsString()
  OPENROUTER_BASE_URL: string = 'https://openrouter.ai/api/v1';

  // RabbitMQ context-engine transport (docs/contracts/context-engine.md).
  // Deliberately OPTIONAL — unset keeps `ContextModule`'s
  // `CONTEXT_REQUEST_PUBLISHER`/`GATHER_TIMEOUT_SCHEDULER`/
  // `ContextResultsConsumer` providers unbound (all three are
  // `RABBITMQ_URL`-gated `useFactory`s), so the legacy synchronous
  // `ContextEngineHttpClient`/stub gather path stays the only one active
  // and boot never requires a broker. Set (amqp:// or amqps://) to switch
  // `ProcessPlanningJobUseCase` onto the async queue-transport path.
  @IsOptional()
  @IsString()
  RABBITMQ_URL?: string;

  // How long (ms) a planning job may sit in `gathering` before the
  // context-engine transport fails it with `error_code:
  // CONTEXT_ENGINE_TIMEOUT` (docs/contracts/context-engine.md §4). Only
  // meaningful when `RABBITMQ_URL` is set — enforced via a durable BullMQ
  // delayed job, not a bare `setTimeout`.
  @IsOptional()
  @IsInt()
  @Min(1)
  CONTEXT_GATHER_TIMEOUT_MS: number = 120_000;

  // Transactional email (password reset, email verification) via Resend.
  // Optional in development/test: with no RESEND_API_KEY the null sender is
  // used and nothing is sent. Required in staging/production (see validate()).
  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @IsString()
  RESEND_API_KEY?: string;

  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @IsString()
  EMAIL_FROM?: string;

  // Public frontend origin that email links are built from — never taken from
  // request data.
  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @Validate(AppBaseUrlConstraint)
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { message: 'APP_BASE_URL must be an http(s) URL' },
  )
  APP_BASE_URL?: string;

  // When true, unverified accounts get 403 on AI, connector and planning
  // routes. Default off in development/test; forced on in staging/production.
  @IsOptional()
  @IsBoolean()
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    parseEmailVerificationRequired(obj.EMAIL_VERIFICATION_REQUIRED),
  )
  EMAIL_VERIFICATION_REQUIRED: boolean = false;

  // Error-tracking (Sentry), roadmap-independent infra plumbing. Mirrors the
  // OPENROUTER_API_KEY convention: deliberately OPTIONAL, and its absence is
  // the master switch — `src/instrument.ts` only calls `Sentry.init()` when
  // SENTRY_DSN is set, so start:dev/unit tests/e2e/smoke all keep working
  // with zero Sentry config. One Sentry project; SENTRY_ENVIRONMENT (falling
  // back to NODE_ENV) tags which deploy environment an event came from
  // rather than splitting into separate projects.
  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  @IsOptional()
  @IsString()
  SENTRY_ENVIRONMENT?: string;

  // Errors-only for this slice — 0 sends no performance/tracing data.
  // Bounded to [0, 1] since it's read by the SDK as a sampling probability.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  SENTRY_TRACES_SAMPLE_RATE: number = 0;

  // Deferred: the var exists so it can be wired up later (e.g. from CI/CD
  // with the deployed commit SHA), but nothing populates it this slice.
  @IsOptional()
  @IsString()
  SENTRY_RELEASE?: string;
}

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: true,
  });

  if (errors.length > 0) {
    const details = errors
      .map(
        (error) =>
          `- ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  // The shape of COMPOSIO_AUTH_CONFIG_IDS is fully known at boot, so validate
  // it eagerly here — a malformed map fails app startup instead of surfacing
  // as a 503 on the first `/connectors/:provider/connect` call.
  parseComposioAuthConfigIds(validated.COMPOSIO_AUTH_CONFIG_IDS);

  if (validated.POSTGRES_SSL && !validated.POSTGRES_SSL_REJECT_UNAUTHORIZED) {
    new Logger('Config').warn(
      `POSTGRES_SSL_REJECT_UNAUTHORIZED is false: Postgres TLS certificates are NOT verified (NODE_ENV=${validated.NODE_ENV})`,
    );
  }

  if (validated.NODE_ENV === 'staging' || validated.NODE_ENV === 'production') {
    const missing = ['RESEND_API_KEY', 'EMAIL_FROM', 'APP_BASE_URL'].filter(
      (key) =>
        !validated[
          key as 'RESEND_API_KEY' | 'EMAIL_FROM' | 'APP_BASE_URL'
        ]?.trim(),
    );
    if (missing.length > 0) {
      throw new Error(
        `Invalid environment configuration:\n- ${missing.join(', ')}: required when NODE_ENV is ${validated.NODE_ENV}`,
      );
    }
    const raw = config.EMAIL_VERIFICATION_REQUIRED;
    if (
      raw !== undefined &&
      blankToUndefined(raw) !== undefined &&
      !parseEmailVerificationRequired(raw)
    ) {
      throw new Error(
        `Invalid environment configuration:\n- EMAIL_VERIFICATION_REQUIRED: cannot be false when NODE_ENV is ${validated.NODE_ENV}`,
      );
    }
    validated.EMAIL_VERIFICATION_REQUIRED = true;

    const unsafe: string[] = [];
    // A blank origin is treated as '*' by `cors`, so it is refused too.
    if (['', '*'].includes(validated.CORS_ORIGIN.trim())) {
      unsafe.push(
        `CORS_ORIGIN: cannot be blank or '*' when NODE_ENV is ${validated.NODE_ENV}`,
      );
    }
    if (['', '*'].includes(validated.WS_CORS_ORIGIN.trim())) {
      unsafe.push(
        `WS_CORS_ORIGIN: cannot be blank or '*' when NODE_ENV is ${validated.NODE_ENV}`,
      );
    }
    if (validated.JWT_SECRET === JWT_SECRET_PLACEHOLDER) {
      unsafe.push(
        `JWT_SECRET: cannot be the .env.example placeholder when NODE_ENV is ${validated.NODE_ENV}`,
      );
    }
    const tlsViolation = postgresSslTierViolation(
      validated.NODE_ENV,
      validated.POSTGRES_SSL_REJECT_UNAUTHORIZED,
    );
    if (tlsViolation) {
      unsafe.push(tlsViolation);
    }
    if (unsafe.length > 0) {
      throw new Error(
        `Invalid environment configuration:\n- ${unsafe.join('\n- ')}`,
      );
    }
  }

  return validated;
}
