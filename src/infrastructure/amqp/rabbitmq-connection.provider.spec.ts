import { ConfigService } from '@nestjs/config';
import { RabbitMqConnectionProvider } from './rabbitmq-connection.provider';

function makeConfig(url: string | undefined): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === 'RABBITMQ_URL' && url) return url;
      throw new Error(`Missing config key "${key}"`);
    },
  } as unknown as ConfigService;
}

describe('RabbitMqConnectionProvider', () => {
  it('constructing the provider itself never reads RABBITMQ_URL (lazy)', () => {
    // Must not throw even though the config has no RABBITMQ_URL — only
    // `getConnection()` reads it.
    expect(
      () => new RabbitMqConnectionProvider(makeConfig(undefined)),
    ).not.toThrow();
  });

  it('getConnection() throws when RABBITMQ_URL is unset', () => {
    const provider = new RabbitMqConnectionProvider(makeConfig(undefined));
    expect(() => provider.getConnection()).toThrow(
      'Missing config key "RABBITMQ_URL"',
    );
  });

  it('onModuleDestroy() is a no-op when a connection was never created', async () => {
    const provider = new RabbitMqConnectionProvider(makeConfig(undefined));
    await expect(provider.onModuleDestroy()).resolves.toBeUndefined();
  });
});
