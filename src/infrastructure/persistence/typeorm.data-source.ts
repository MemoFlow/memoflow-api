import 'dotenv/config';
import { DataSource } from 'typeorm';
import {
  assertPostgresSslSafe,
  postgresSslOptions,
} from '../../config/postgres-ssl';

// The CLI bypasses validate(); enforce the same TLS rules here.
assertPostgresSslSafe(
  process.env.NODE_ENV,
  process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED,
);

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
  // Same helper as the runtime connection; verifies the certificate unless
  // POSTGRES_SSL_REJECT_UNAUTHORIZED=false (dev-only escape hatch).
  ssl: postgresSslOptions(
    process.env.POSTGRES_SSL,
    process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED,
  ),
  // Only TypeORM entities (`*.orm-entity.ts`) — domain entities (`*.entity.ts`)
  // are plain classes with no typeorm decorators and must stay out of this glob.
  entities: ['src/**/*.orm-entity.ts'],
  migrations: ['src/infrastructure/persistence/migrations/*.ts'],
});
