import { BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PROMPT_CREATED_EVENT } from '../../domain/audit/audit-events';
import { CreatePromptUseCase } from './create-prompt.use-case';
import { InMemoryPromptRepository, makePrompt } from './testing-fakes';

function build(prompts = [makePrompt()]) {
  const repository = new InMemoryPromptRepository(prompts);
  const emitter = new EventEmitter2();
  const emit = jest.spyOn(emitter, 'emit');
  return {
    repository,
    emit,
    useCase: new CreatePromptUseCase(repository, emitter),
  };
}

const valid = {
  actorId: 'admin-1',
  featureType: 'suggestion',
  version: 'v3',
  systemTemplate: 'Sys <untrusted_{{nonce}}>',
  userTemplate: '<untrusted_{{nonce}}>{{content}}</untrusted_{{nonce}}>',
};

describe('CreatePromptUseCase', () => {
  it('creates an inactive prompt, takes userInvocable from the definition, and audits', async () => {
    const { useCase, emit } = build();

    const prompt = await useCase.execute(valid);

    expect(prompt.isActive).toBe(false);
    expect(prompt.userInvocable).toBe(true);
    expect(prompt.template).toBe(valid.userTemplate);
    expect(prompt.systemTemplate).toBe(valid.systemTemplate);
    expect(emit).toHaveBeenCalledWith(PROMPT_CREATED_EVENT, {
      userId: 'admin-1',
      promptId: prompt.id,
      featureType: 'suggestion',
      version: 'v3',
    });
  });

  it('accepts the light {{context}} placeholder in an invocable user template, but still not in the system template', async () => {
    const { useCase } = build();

    const prompt = await useCase.execute({
      ...valid,
      userTemplate: 'Context: {{context}}\nText: {{content}}',
    });

    expect(prompt.template).toContain('{{context}}');
    await expect(
      useCase.execute({
        ...valid,
        version: 'v4',
        systemTemplate: 'Sys {{context}}',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('marks a planning prompt as not user-invocable', async () => {
    const { useCase } = build();

    const prompt = await useCase.execute({
      ...valid,
      featureType: 'planning',
      userTemplate: 'Request: {{prompt}} {{context}}',
    });

    expect(prompt.userInvocable).toBe(false);
  });

  it('rejects an unknown feature type', async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({ ...valid, featureType: 'poem' }),
    ).rejects.toThrow(BadRequestException);
  });

  it.each([
    ['system {{prompt}}', { systemTemplate: 'Sys {{prompt}}' }],
    ['system {{content}}', { systemTemplate: 'Sys {{content}}' }],
    ['system {{context}}', { systemTemplate: 'Sys {{context}}' }],
    ['user {{prompt}}', { userTemplate: '{{content}} {{prompt}}' }],
    ['unknown name', { userTemplate: '{{content}} {{secret}}' }],
  ])('rejects a disallowed placeholder (%s)', async (_label, override) => {
    const { useCase, repository } = build();
    await expect(useCase.execute({ ...valid, ...override })).rejects.toThrow(
      BadRequestException,
    );
    expect(repository.prompts).toHaveLength(1);
  });

  it.each([
    ['hyphenated name', { userTemplate: '{{content}} {{foo-bar}}' }],
    ['unclosed opener', { userTemplate: '{{content}} {{oops' }],
    ['stray closer', { systemTemplate: 'Sys }} <untrusted_{{nonce}}>' }],
    ['empty braces', { systemTemplate: 'Sys {{}}' }],
  ])('rejects a malformed placeholder (%s)', async (_label, override) => {
    const { useCase, repository } = build();
    await expect(useCase.execute({ ...valid, ...override })).rejects.toThrow(
      BadRequestException,
    );
    expect(repository.prompts).toHaveLength(1);
  });

  it('requires {{content}} in an invocable user template', async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({ ...valid, userTemplate: 'no placeholder' }),
    ).rejects.toThrow(/\{\{content\}\}/);
  });

  it('requires {{prompt}} in the planning user template', async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({
        ...valid,
        featureType: 'planning',
        userTemplate: '{{context}}',
      }),
    ).rejects.toThrow(/\{\{prompt\}\}/);
  });

  it('409s on a duplicate (feature type, version)', async () => {
    const { useCase, emit } = build();
    await expect(useCase.execute({ ...valid, version: 'v1' })).rejects.toThrow(
      ConflictException,
    );
    expect(emit).not.toHaveBeenCalled();
  });
});
