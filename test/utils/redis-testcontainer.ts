import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

export interface RedisTestEnv {
  container: StartedRedisContainer;
  env: {
    REDIS_HOST: string;
    REDIS_PORT: string;
  };
}

/**
 * Mirrors `pg-testcontainer.ts`'s Docker-availability gate — see
 * `isDockerAvailable`/`describeWithDocker` there for the shared reasoning
 * (identical gating: hard-fail in CI, skip locally when Docker is absent).
 * The Context e2e suite needs both PostgreSQL and Redis, so it reuses that
 * same gate rather than duplicating the Docker check.
 */
export async function startRedisContainer(): Promise<RedisTestEnv> {
  const container = await new RedisContainer('redis:7').start();
  return {
    container,
    env: {
      REDIS_HOST: container.getHost(),
      REDIS_PORT: String(container.getPort()),
    },
  };
}
