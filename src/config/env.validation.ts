import { Transform, plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export const NODE_ENVS = [
  'development',
  'staging',
  'production',
  'test',
] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/**
 * Case-insensitive "true" check shared between the runtime config
 * (env.validation.ts, via @Transform) and the standalone TypeORM CLI
 * data source (typeorm.data-source.ts, reading process.env directly) so
 * POSTGRES_SSL parses identically in both places.
 */
export function parsePostgresSsl(value: unknown): boolean {
  return String(value).toLowerCase() === 'true';
}

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

  @IsString()
  @IsNotEmpty()
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

  // Dev default '*' is convenient locally but unsafe beyond it — staging and
  // production must set this explicitly to the real frontend origin.
  @IsOptional()
  @IsString()
  WS_CORS_ORIGIN: string = '*';

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
  @IsOptional()
  @IsString()
  ANTHROPIC_API_KEY?: string;

  @IsOptional()
  @IsString()
  ANTHROPIC_MODEL: string = 'claude-sonnet-5';

  @IsOptional()
  @IsInt()
  @Min(1)
  ANTHROPIC_MAX_TOKENS: number = 4096;
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

  return validated;
}
