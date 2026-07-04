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

  // Dev default '*' is convenient locally but unsafe beyond it — staging and
  // production must set this explicitly to the real frontend origin.
  @IsOptional()
  @IsString()
  WS_CORS_ORIGIN: string = '*';
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
  return validated;
}
