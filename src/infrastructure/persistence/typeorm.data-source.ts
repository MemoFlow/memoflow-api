import 'dotenv/config';
import { DataSource } from 'typeorm';

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
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/infrastructure/persistence/migrations/*.ts'],
});
