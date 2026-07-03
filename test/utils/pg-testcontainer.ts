import { execSync } from 'node:child_process';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

export interface PgTestEnv {
  container: StartedPostgreSqlContainer;
  env: {
    POSTGRES_HOST: string;
    POSTGRES_PORT: string;
    POSTGRES_USER: string;
    POSTGRES_PASSWORD: string;
    POSTGRES_DB: string;
  };
}

/**
 * Testcontainers needs a running Docker daemon. Suites that exercise
 * PostgreSQL should gate themselves on this so `npm run test:e2e` stays
 * green on machines (and CI/remote sandboxes) without Docker.
 */
export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function startPgContainer(): Promise<PgTestEnv> {
  const container = await new PostgreSqlContainer('postgres:16').start();
  return {
    container,
    env: {
      POSTGRES_HOST: container.getHost(),
      POSTGRES_PORT: String(container.getPort()),
      POSTGRES_USER: container.getUsername(),
      POSTGRES_PASSWORD: container.getPassword(),
      POSTGRES_DB: container.getDatabase(),
    },
  };
}
