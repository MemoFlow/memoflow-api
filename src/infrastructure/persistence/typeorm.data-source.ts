import 'dotenv/config';
import { DataSource } from 'typeorm';
import { parsePostgresSsl } from '../../config/env.validation';

/**
 * Standalone data source for the TypeORM CLI (migration:generate/run/revert/show).
 * The runtime connection is configured separately in app.module.ts.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  // rejectUnauthorized:false — dev/staging managed Postgres (e.g. Neon) that
  // don't provide a CA cert. Revisit if a verifiable CA becomes available.
  ssl: parsePostgresSsl(process.env.POSTGRES_SSL)
    ? { rejectUnauthorized: false }
    : false,
  // Only TypeORM entities (`*.orm-entity.ts`) — domain entities (`*.entity.ts`)
  // are plain classes with no typeorm decorators and must stay out of this glob.
  entities: ['src/**/*.orm-entity.ts'],
  migrations: ['src/infrastructure/persistence/migrations/*.ts'],
});
