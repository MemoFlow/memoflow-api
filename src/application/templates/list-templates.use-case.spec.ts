import { Template } from '../../domain/templates/template.entity';
import {
  TemplateFilters,
  TemplatePage,
  TemplateRepository,
} from '../../domain/templates/template.repository';
import { ListTemplatesUseCase } from './list-templates.use-case';

class InMemoryTemplateRepository implements TemplateRepository {
  public findVisibleCalls: {
    userId: string;
    filters: TemplateFilters;
    page: TemplatePage;
  }[] = [];

  constructor(private readonly templates: Template[] = []) {}

  create(): Promise<Template> {
    return Promise.reject(new Error('not implemented'));
  }

  findById(): Promise<Template | null> {
    return Promise.reject(new Error('not implemented'));
  }

  findVisible(
    userId: string,
    filters: TemplateFilters,
    page: TemplatePage,
  ): Promise<Template[]> {
    this.findVisibleCalls.push({ userId, filters, page });
    return Promise.resolve(
      this.templates.filter((t) => t.isPublished || t.createdBy === userId),
    );
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

describe('ListTemplatesUseCase', () => {
  it('delegates to findVisible with the requesting user and optional filters', async () => {
    const own = makeTemplate({ id: 'template-1', createdBy: 'user-1' });
    const published = makeTemplate({
      id: 'template-2',
      createdBy: 'user-2',
      isPublished: true,
    });
    const repository = new InMemoryTemplateRepository([own, published]);
    const useCase = new ListTemplatesUseCase(repository);

    const result = await useCase.execute({
      userId: 'user-1',
      docType: 'blog',
      scope: 'personal',
    });

    expect(repository.findVisibleCalls).toEqual([
      {
        userId: 'user-1',
        filters: { docType: 'blog', scope: 'personal' },
        page: { limit: 20, offset: 0 },
      },
    ]);
    expect(result).toEqual([own, published]);
  });

  it('passes explicit limit/offset through', async () => {
    const repository = new InMemoryTemplateRepository();
    const useCase = new ListTemplatesUseCase(repository);

    await useCase.execute({ userId: 'user-1', limit: 5, offset: 10 });

    expect(repository.findVisibleCalls[0].page).toEqual({
      limit: 5,
      offset: 10,
    });
  });

  it('clamps an out-of-range limit/offset defensively', async () => {
    const repository = new InMemoryTemplateRepository();
    const useCase = new ListTemplatesUseCase(repository);

    await useCase.execute({ userId: 'user-1', limit: 100_000, offset: -3 });
    await useCase.execute({ userId: 'user-1', limit: 0 });

    expect(repository.findVisibleCalls[0].page).toEqual({
      limit: 100,
      offset: 0,
    });
    expect(repository.findVisibleCalls[1].page.limit).toBe(1);
  });
});
