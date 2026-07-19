import { NotFoundException } from '@nestjs/common';
import { Template } from '../../domain/templates/template.entity';
import { TemplateRepository } from '../../domain/templates/template.repository';
import { DeleteTemplateUseCase } from './delete-template.use-case';

class InMemoryTemplateRepository implements TemplateRepository {
  public deleteCalls: string[] = [];

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

  delete(id: string): Promise<void> {
    this.deleteCalls.push(id);
    return Promise.resolve();
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

describe('DeleteTemplateUseCase', () => {
  it('deletes a template owned by the requesting user', async () => {
    const repository = new InMemoryTemplateRepository([makeTemplate()]);
    const useCase = new DeleteTemplateUseCase(repository);

    await useCase.execute({ userId: 'user-1', templateId: 'template-1' });

    expect(repository.deleteCalls).toEqual(['template-1']);
  });

  it('throws NotFoundException when the template does not exist', async () => {
    const repository = new InMemoryTemplateRepository([]);
    const useCase = new DeleteTemplateUseCase(repository);

    await expect(
      useCase.execute({ userId: 'user-1', templateId: 'missing' }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.deleteCalls).toEqual([]);
  });

  it("throws NotFoundException (and does not delete) for another user's template", async () => {
    const repository = new InMemoryTemplateRepository([
      makeTemplate({ createdBy: 'user-1' }),
    ]);
    const useCase = new DeleteTemplateUseCase(repository);

    await expect(
      useCase.execute({ userId: 'user-2', templateId: 'template-1' }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.deleteCalls).toEqual([]);
  });

  it('throws NotFoundException for a published system template (createdBy null)', async () => {
    const repository = new InMemoryTemplateRepository([
      makeTemplate({ createdBy: null, isPublished: true }),
    ]);
    const useCase = new DeleteTemplateUseCase(repository);

    await expect(
      useCase.execute({ userId: 'user-1', templateId: 'template-1' }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.deleteCalls).toEqual([]);
  });
});
