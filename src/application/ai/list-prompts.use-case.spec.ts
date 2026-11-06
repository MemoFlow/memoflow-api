import { ListPromptsUseCase } from './list-prompts.use-case';
import { InMemoryPromptRepository, makePrompt } from './testing-fakes';

describe('ListPromptsUseCase', () => {
  const repository = new InMemoryPromptRepository([
    makePrompt({ id: 'a' }),
    makePrompt({ id: 'b', featureType: 'rewrite' }),
  ]);
  const useCase = new ListPromptsUseCase(repository);

  it('lists everything without a filter', async () => {
    expect(await useCase.execute({})).toHaveLength(2);
  });

  it('filters by feature type', async () => {
    const result = await useCase.execute({ featureType: 'rewrite' });
    expect(result.map((p) => p.id)).toEqual(['b']);
  });
});
