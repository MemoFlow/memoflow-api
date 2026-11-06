import {
  ContextEnginePort,
  GatherContextInput,
} from '../../domain/context/context-engine.port';
import { ConnectorContextGatherer } from './connector-context-gatherer';

class FakeContextEngine implements ContextEnginePort {
  lastInput: GatherContextInput | null = null;
  result: Record<string, unknown> = { note: 'from context engine' };

  gatherContext(input: GatherContextInput): Promise<Record<string, unknown>> {
    this.lastInput = input;
    return Promise.resolve(this.result);
  }
}

describe('ConnectorContextGatherer', () => {
  it('delegates gather() to the ContextEnginePort with the same input', async () => {
    const engine = new FakeContextEngine();
    const gatherer = new ConnectorContextGatherer(engine);
    const input = {
      userId: 'user-1',
      connectors: ['trello'],
      prompt: 'Plan my chapter',
    };

    const result = await gatherer.gather(input);

    expect(engine.lastInput).toEqual(input);
    expect(result).toBe(engine.result);
  });

  it('propagates a context-engine failure rather than swallowing it', async () => {
    const engine = new FakeContextEngine();
    engine.gatherContext = () =>
      Promise.reject(new Error('context engine unavailable'));
    const gatherer = new ConnectorContextGatherer(engine);

    await expect(
      gatherer.gather({ userId: 'user-1', connectors: [], prompt: 'hi' }),
    ).rejects.toThrow('context engine unavailable');
  });

  it('formats the request (trims prompt, dedupes connectors) before delegating', async () => {
    const engine = new FakeContextEngine();
    const gatherer = new ConnectorContextGatherer(engine);

    await gatherer.gather({
      userId: 'user-1',
      connectors: ['trello', 'trello'],
      prompt: '  Plan   my chapter  ',
    });

    expect(engine.lastInput).toEqual({
      userId: 'user-1',
      connectors: ['trello'],
      prompt: 'Plan my chapter',
    });
  });
});
