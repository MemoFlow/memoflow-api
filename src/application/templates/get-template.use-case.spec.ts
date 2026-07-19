import { NotFoundException } from '@nestjs/common';
import { Template } from '../../domain/templates/template.entity';
import { TemplateRepository } from '../../domain/templates/template.repository';
import { GetTemplateUseCase } from './get-template.use-case';

class InMemoryTemplateRepository implements TemplateRepository {
  constructor(private readonly templates: Template[] = []) {}

  create(): Promise<Template> {
    return Promise.reject(new Error('not implemented'));
  }

  findById(id: string): Promise<Template | null> {
    return Promise.resolve(this.templates.find((t) => t.id === id) ?? null);
  }

  findVisible(): Promise<Template[]> {
    return Promise.reject(new Error('not implemented'));
  }

  update(): Promise<Template> {
    return Promise.reject(new Error('not implemented'));
  }

  delete(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
}

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return new Template({
    id: 'template-1',
    title: 'Standard Blog Post',
    docType: 'blog',
    scope: 'personal',
    createdBy: 'user-1',
    styleConfig: null,
    isPublished: false,
    sections: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('GetTemplateUseCase', () => {
  it('returns an unpublished template to its owner', async () => {
    const template = makeTemplate({ isPublished: false, createdBy: 'user-1' });
    const useCase = new GetTemplateUseCase(
      new InMemoryTemplateRepository([template]),
    );

    const result = await useCase.execute({
      userId: 'user-1',
      templateId: 'template-1',
    });

    expect(result).toBe(template);
  });

  it('returns a published template to a different user', async () => {
    const template = makeTemplate({ isPublished: true, createdBy: 'user-1' });
    const useCase = new GetTemplateUseCase(
      new InMemoryTemplateRepository([template]),
    );

    const result = await useCase.execute({
      userId: 'user-2',
      templateId: 'template-1',
    });

    expect(result).toBe(template);
  });

  it('throws NotFoundException for an unpublished template owned by someone else', async () => {
    const template = makeTemplate({ isPublished: false, createdBy: 'user-1' });
    const useCase = new GetTemplateUseCase(
      new InMemoryTemplateRepository([template]),
    );

    await expect(
      useCase.execute({ userId: 'user-2', templateId: 'template-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for an unpublished system template (createdBy null)', async () => {
    const template = makeTemplate({ isPublished: false, createdBy: null });
    const useCase = new GetTemplateUseCase(
      new InMemoryTemplateRepository([template]),
    );

    await expect(
      useCase.execute({ userId: 'user-1', templateId: 'template-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the template does not exist', async () => {
    const useCase = new GetTemplateUseCase(new InMemoryTemplateRepository([]));

    await expect(
      useCase.execute({ userId: 'user-1', templateId: 'missing' }),
    ).rejects.toThrow(NotFoundException);
  });
});
