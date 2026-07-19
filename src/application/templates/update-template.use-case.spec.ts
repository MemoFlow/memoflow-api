import { NotFoundException } from '@nestjs/common';
import { Template } from '../../domain/templates/template.entity';
import { TemplateSection } from '../../domain/templates/template-section.entity';
import {
  TemplateRepository,
  UpdateTemplateData,
} from '../../domain/templates/template.repository';
import { UpdateTemplateUseCase } from './update-template.use-case';

class InMemoryTemplateRepository implements TemplateRepository {
  public updateCalls: { id: string; patch: UpdateTemplateData }[] = [];

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

  update(id: string, patch: UpdateTemplateData): Promise<Template> {
    this.updateCalls.push({ id, patch });
    const existing = this.templates.find((t) => t.id === id);
    if (!existing) {
      return Promise.reject(new Error('not found'));
    }
    const updated = new Template({
      ...existing,
      title: patch.title ?? existing.title,
      isPublished: patch.isPublished ?? existing.isPublished,
      sections: patch.sections
        ? patch.sections.map(
            (section) =>
              new TemplateSection({
                id: 'new-section',
                templateId: id,
                title: section.title,
                order: section.order,
                wordCountMin: section.wordCountMin,
                wordCountMax: section.wordCountMax,
                isRequired: section.isRequired,
              }),
          )
        : existing.sections,
    });
    return Promise.resolve(updated);
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

describe('UpdateTemplateUseCase', () => {
  it('updates a template owned by the requesting user', async () => {
    const repository = new InMemoryTemplateRepository([makeTemplate()]);
    const useCase = new UpdateTemplateUseCase(repository);

    const result = await useCase.execute({
      userId: 'user-1',
      templateId: 'template-1',
      patch: { title: 'Renamed', isPublished: true },
    });

    expect(result.title).toBe('Renamed');
    expect(result.isPublished).toBe(true);
  });

  it('replaces sections wholesale when sections are provided in the patch', async () => {
    const repository = new InMemoryTemplateRepository([makeTemplate()]);
    const useCase = new UpdateTemplateUseCase(repository);

    const result = await useCase.execute({
      userId: 'user-1',
      templateId: 'template-1',
      patch: {
        sections: [
          {
            title: 'New Section',
            order: 0,
            wordCountMin: 10,
            wordCountMax: 100,
          },
        ],
      },
    });

    expect(repository.updateCalls[0].patch.sections).toEqual([
      {
        title: 'New Section',
        order: 0,
        wordCountMin: 10,
        wordCountMax: 100,
        isRequired: false,
      },
    ]);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBe('New Section');
  });

  it('throws NotFoundException when the template does not exist', async () => {
    const useCase = new UpdateTemplateUseCase(
      new InMemoryTemplateRepository([]),
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        templateId: 'missing',
        patch: { title: 'X' },
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when a different user attempts to edit', async () => {
    const useCase = new UpdateTemplateUseCase(
      new InMemoryTemplateRepository([makeTemplate({ createdBy: 'user-1' })]),
    );

    await expect(
      useCase.execute({
        userId: 'user-2',
        templateId: 'template-1',
        patch: { title: 'Hijacked' },
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a system template (createdBy null), even for a published one', async () => {
    const useCase = new UpdateTemplateUseCase(
      new InMemoryTemplateRepository([
        makeTemplate({ createdBy: null, isPublished: true }),
      ]),
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        templateId: 'template-1',
        patch: { title: 'Hijacked' },
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
