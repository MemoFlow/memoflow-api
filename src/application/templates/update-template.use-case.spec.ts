import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '../../domain/users/user-role';
import { Template } from '../../domain/templates/template.entity';
import { TemplateSection } from '../../domain/templates/template-section.entity';
import {
  TemplatePublishedError,
  TemplateRepository,
  UpdateTemplateData,
  UpdateTemplateOptions,
} from '../../domain/templates/template.repository';
import { UpdateTemplateUseCase } from './update-template.use-case';

class InMemoryTemplateRepository implements TemplateRepository {
  public updateCalls: {
    id: string;
    patch: UpdateTemplateData;
    options?: UpdateTemplateOptions;
  }[] = [];

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

  update(
    id: string,
    patch: UpdateTemplateData,
    options?: UpdateTemplateOptions,
  ): Promise<Template> {
    this.updateCalls.push({ id, patch, options });
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
  const emit = jest.fn();
  const emitter = { emit } as unknown as EventEmitter2;

  beforeEach(() => emit.mockClear());

  it('updates (and, as an admin, publishes) a template owned by the requesting user', async () => {
    const repository = new InMemoryTemplateRepository([makeTemplate()]);
    const useCase = new UpdateTemplateUseCase(repository, emitter);

    const result = await useCase.execute({
      userId: 'user-1',
      role: UserRole.Admin,
      templateId: 'template-1',
      patch: { title: 'Renamed', isPublished: true },
    });

    expect(result.title).toBe('Renamed');
    expect(result.isPublished).toBe(true);
  });

  it('replaces sections wholesale when sections are provided in the patch', async () => {
    const repository = new InMemoryTemplateRepository([makeTemplate()]);
    const useCase = new UpdateTemplateUseCase(repository, emitter);

    const result = await useCase.execute({
      userId: 'user-1',
      role: UserRole.User,
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
      emitter,
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        role: UserRole.User,
        templateId: 'missing',
        patch: { title: 'X' },
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when a different user attempts to edit', async () => {
    const useCase = new UpdateTemplateUseCase(
      new InMemoryTemplateRepository([makeTemplate({ createdBy: 'user-1' })]),
      emitter,
    );

    await expect(
      useCase.execute({
        userId: 'user-2',
        role: UserRole.User,
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
      emitter,
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        role: UserRole.User,
        templateId: 'template-1',
        patch: { title: 'Hijacked' },
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when a non-admin publishes their own template', async () => {
    const repository = new InMemoryTemplateRepository([makeTemplate()]);
    const useCase = new UpdateTemplateUseCase(repository, emitter);

    await expect(
      useCase.execute({
        userId: 'user-1',
        role: UserRole.User,
        templateId: 'template-1',
        patch: { isPublished: true },
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(repository.updateCalls).toEqual([]);
  });

  it('throws ForbiddenException when a non-admin owner edits an already published template', async () => {
    const repository = new InMemoryTemplateRepository([
      makeTemplate({ isPublished: true }),
    ]);
    const useCase = new UpdateTemplateUseCase(repository, emitter);

    await expect(
      useCase.execute({
        userId: 'user-1',
        role: UserRole.User,
        templateId: 'template-1',
        patch: { title: 'Renamed' },
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(repository.updateCalls).toEqual([]);
  });

  it("lets an admin edit and unpublish another user's published template", async () => {
    const repository = new InMemoryTemplateRepository([
      makeTemplate({ isPublished: true }),
    ]);
    const useCase = new UpdateTemplateUseCase(repository, emitter);

    const result = await useCase.execute({
      userId: 'admin-1',
      role: UserRole.Admin,
      templateId: 'template-1',
      patch: { title: 'Edited', isPublished: false },
    });

    expect(result.title).toBe('Edited');
    expect(result.isPublished).toBe(false);
  });

  it('lets an admin edit a system template', async () => {
    const useCase = new UpdateTemplateUseCase(
      new InMemoryTemplateRepository([
        makeTemplate({ createdBy: null, isPublished: true }),
      ]),
      emitter,
    );

    const result = await useCase.execute({
      userId: 'admin-1',
      role: UserRole.Admin,
      templateId: 'template-1',
      patch: { title: 'Edited' },
    });

    expect(result.title).toBe('Edited');
  });

  it('emits template.updated with the changed field names only', async () => {
    const useCase = new UpdateTemplateUseCase(
      new InMemoryTemplateRepository([makeTemplate()]),
      emitter,
    );

    await useCase.execute({
      userId: 'user-1',
      role: UserRole.User,
      templateId: 'template-1',
      patch: { title: 'Renamed', scope: undefined },
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('template.updated', {
      userId: 'user-1',
      templateId: 'template-1',
      changedFields: ['title'],
    });
  });

  it('also emits template.published when the patch publishes', async () => {
    const useCase = new UpdateTemplateUseCase(
      new InMemoryTemplateRepository([makeTemplate()]),
      emitter,
    );

    await useCase.execute({
      userId: 'admin-1',
      role: UserRole.Admin,
      templateId: 'template-1',
      patch: { isPublished: true },
    });

    expect(emit.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'template.updated',
      'template.published',
    ]);
    expect(emit).toHaveBeenCalledWith('template.published', {
      userId: 'admin-1',
      templateId: 'template-1',
    });
  });

  it('also emits template.unpublished when the patch unpublishes', async () => {
    const useCase = new UpdateTemplateUseCase(
      new InMemoryTemplateRepository([makeTemplate({ isPublished: true })]),
      emitter,
    );

    await useCase.execute({
      userId: 'admin-1',
      role: UserRole.Admin,
      templateId: 'template-1',
      patch: { isPublished: false },
    });

    expect(emit.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'template.updated',
      'template.unpublished',
    ]);
  });

  it('does not emit publish events when is_published is unchanged', async () => {
    const useCase = new UpdateTemplateUseCase(
      new InMemoryTemplateRepository([makeTemplate({ isPublished: true })]),
      emitter,
    );

    await useCase.execute({
      userId: 'admin-1',
      role: UserRole.Admin,
      templateId: 'template-1',
      patch: { isPublished: true },
    });

    expect(emit.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'template.updated',
    ]);
  });

  it('asks the repository to enforce unpublished-only for non-admins, not admins', async () => {
    const repository = new InMemoryTemplateRepository([makeTemplate()]);
    const useCase = new UpdateTemplateUseCase(repository, emitter);

    await useCase.execute({
      userId: 'user-1',
      role: UserRole.User,
      templateId: 'template-1',
      patch: { title: 'A' },
    });
    await useCase.execute({
      userId: 'admin-1',
      role: UserRole.Admin,
      templateId: 'template-1',
      patch: { title: 'B' },
    });

    expect(repository.updateCalls.map((c) => c.options)).toEqual([
      { onlyIfUnpublished: true },
      { onlyIfUnpublished: false },
    ]);
  });

  it('maps a concurrent publish detected by the repository to 403 and emits nothing', async () => {
    const repository = new InMemoryTemplateRepository([makeTemplate()]);
    repository.update = () => Promise.reject(new TemplatePublishedError());
    const useCase = new UpdateTemplateUseCase(repository, emitter);

    await expect(
      useCase.execute({
        userId: 'user-1',
        role: UserRole.User,
        templateId: 'template-1',
        patch: { title: 'Late edit' },
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(emit).not.toHaveBeenCalled();
  });
});
