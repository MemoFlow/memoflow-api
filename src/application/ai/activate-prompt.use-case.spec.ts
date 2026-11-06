import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PROMPT_ACTIVATED_EVENT } from '../../domain/audit/audit-events';
import { ActivatePromptUseCase } from './activate-prompt.use-case';
import { InMemoryPromptRepository, makePrompt } from './testing-fakes';

function build() {
  const repository = new InMemoryPromptRepository([
    makePrompt({ id: 'a', version: 'v1', isActive: true }),
    makePrompt({ id: 'b', version: 'v2', isActive: false }),
    makePrompt({ id: 'c', featureType: 'rewrite', isActive: true }),
  ]);
  const emitter = new EventEmitter2();
  const emit = jest.spyOn(emitter, 'emit');
  return {
    repository,
    emit,
    useCase: new ActivatePromptUseCase(repository, emitter),
  };
}

describe('ActivatePromptUseCase', () => {
  it('switches the active prompt of the feature type only, and audits', async () => {
    const { useCase, repository, emit } = build();

    const prompt = await useCase.execute({ actorId: 'admin-1', promptId: 'b' });

    expect(prompt.isActive).toBe(true);
    const active = repository.prompts
      .filter((p) => p.isActive)
      .map((p) => p.id);
    expect(active.sort()).toEqual(['b', 'c']);
    expect(emit).toHaveBeenCalledWith(PROMPT_ACTIVATED_EVENT, {
      userId: 'admin-1',
      promptId: 'b',
      featureType: 'suggestion',
      version: 'v2',
    });
  });

  it('404s for a missing prompt', async () => {
    const { useCase, emit } = build();
    await expect(
      useCase.execute({ actorId: 'admin-1', promptId: 'zzz' }),
    ).rejects.toThrow(NotFoundException);
    expect(emit).not.toHaveBeenCalled();
  });

  it('maps a concurrent-activation conflict to 409', async () => {
    const { useCase, repository } = build();
    repository.activationConflict = true;
    await expect(
      useCase.execute({ actorId: 'admin-1', promptId: 'b' }),
    ).rejects.toThrow(ConflictException);
  });
});
