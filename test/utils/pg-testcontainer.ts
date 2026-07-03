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

/**
 * Resolves the `describe` block a PostgreSQL-backed e2e spec should use.
 *
 * - Docker available → the suite runs normally.
 * - Docker absent locally (no `CI` env var) → the suite is skipped so
 *   `npm run test:e2e` stays green on machines without Docker.
 * - Docker absent in CI → registers a real failing test so the job fails
 *   loudly instead of silently skipping (Jest's default reporter doesn't
 *   print skipped test titles to non-TTY stdout, so grepping job logs for
 *   a "skipped" marker is not a reliable guard).
 */
export function describeWithDocker(): jest.Describe {
  if (isDockerAvailable()) {
    return describe;
  }

  if (process.env.CI) {
    it('fails: Docker is required for this e2e suite in CI', () => {
      throw new Error(
        'Docker daemon unavailable in CI — Testcontainers PostgreSQL e2e suite cannot run',
      );
    });
  }

  return describe.skip;
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
