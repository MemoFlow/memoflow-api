import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '../../domain/users/user-role';
import { randomUUID } from 'node:crypto';
import { LimitReachedError } from '../../domain/limits/storage-limits';
import { Template } from '../../domain/templates/template.entity';
import { TemplateSection } from '../../domain/templates/template-section.entity';
import {
  CreateTemplateData,
  CreateTemplateOptions,
  TemplateRepository,
} from '../../domain/templates/template.repository';
import { DEFAULT_STORAGE_LIMITS } from '../../domain/limits/storage-limits';
import { CreateTemplateUseCase } from './create-template.use-case';

class InMemoryTemplateRepository implements TemplateRepository {
  private readonly templates: Template[] = [];
  public readonly createOptions: CreateTemplateOptions[] = [];

  create(
    data: CreateTemplateData,
    options: CreateTemplateOptions = {},
  ): Promise<Template> {
    this.createOptions.push(options);
    if (
      options.maxPerUser !== null &&
      options.maxPerUser !== undefined &&
      this.templates.filter((t) => t.createdBy === data.createdBy).length >=
        options.maxPerUser
    ) {
      return Promise.reject(
        new LimitReachedError('template', options.maxPerUser),
      );
    }
    const now = new Date();
    const templateId = randomUUID();
    const template = new Template({
      id: templateId,
      title: data.title,
      docType: data.docType,
      scope: data.scope,
      createdBy: data.createdBy,
      styleConfig: data.styleConfig,
      isPublished: data.isPublished,
      sections: data.sections.map(
        (section) =>
          new TemplateSection({
            id: randomUUID(),
            templateId,
            title: section.title,
            order: section.order,
            wordCountMin: section.wordCountMin,
            wordCountMax: section.wordCountMax,
            isRequired: section.isRequired,
            keyPoints: section.keyPoints,
            guidance: section.guidance,
          }),
      ),
      createdAt: now,
      updatedAt: now,
    });
    this.templates.push(template);
    return Promise.resolve(template);
  }

  findById(): Promise<Template | null> {
    return Promise.reject(new Error('not implemented'));
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

describe('CreateTemplateUseCase', () => {
  const emit = jest.fn();
  const emitter = { emit } as unknown as EventEmitter2;

  beforeEach(() => emit.mockClear());

  it('creates a template defaulting isPublished to false and styleConfig to null', async () => {
    const repository = new InMemoryTemplateRepository();
    const useCase = new CreateTemplateUseCase(
      repository,
      emitter,
      DEFAULT_STORAGE_LIMITS,
    );

    const template = await useCase.execute({
      userId: 'user-1',
      role: UserRole.User,
      title: 'Standard Blog Post',
      docType: 'blog',
      scope: 'personal',
      sections: [
        { title: 'Intro', order: 0, wordCountMin: 50, wordCountMax: 200 },
      ],
    });

    expect(template.createdBy).toBe('user-1');
    expect(template.isPublished).toBe(false);
    expect(template.styleConfig).toBeNull();
    expect(template.sections).toHaveLength(1);
    expect(template.sections[0]).toMatchObject({
      title: 'Intro',
      order: 0,
      wordCountMin: 50,
      wordCountMax: 200,
      isRequired: false,
    });
  });

  it('lets an admin publish and honors an explicit isPublished, styleConfig, and per-section isRequired', async () => {
    const repository = new InMemoryTemplateRepository();
    const useCase = new CreateTemplateUseCase(
      repository,
      emitter,
      DEFAULT_STORAGE_LIMITS,
    );

    const template = await useCase.execute({
      userId: 'user-1',
      role: UserRole.Admin,
      title: 'Standard Blog Post',
      docType: 'blog',
      scope: 'org',
      styleConfig: { theme: 'dark' },
      isPublished: true,
      sections: [
        {
          title: 'Intro',
          order: 0,
          wordCountMin: 50,
          wordCountMax: 200,
          isRequired: true,
        },
      ],
    });

    expect(template.isPublished).toBe(true);
    expect(template.styleConfig).toEqual({ theme: 'dark' });
    expect(template.sections[0].isRequired).toBe(true);
  });

  it('throws ForbiddenException when a non-admin creates a published template', async () => {
    const repository = new InMemoryTemplateRepository();
    const useCase = new CreateTemplateUseCase(
      repository,
      emitter,
      DEFAULT_STORAGE_LIMITS,
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        role: UserRole.User,
        title: 'Standard Blog Post',
        docType: 'blog',
        scope: 'org',
        isPublished: true,
        sections: [],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('emits template.created, and template.published when created published', async () => {
    const useCase = new CreateTemplateUseCase(
      new InMemoryTemplateRepository(),
      emitter,
      DEFAULT_STORAGE_LIMITS,
    );

    const created = await useCase.execute({
      userId: 'admin-1',
      role: UserRole.Admin,
      title: 'T',
      docType: 'blog',
      scope: 'personal',
      isPublished: true,
      sections: [],
    });

    const payload = { userId: 'admin-1', templateId: created.id };
    expect(emit).toHaveBeenCalledWith('template.created', payload);
    expect(emit).toHaveBeenCalledWith('template.published', payload);
  });

  it('emits only template.created for an unpublished template', async () => {
    const useCase = new CreateTemplateUseCase(
      new InMemoryTemplateRepository(),
      emitter,
      DEFAULT_STORAGE_LIMITS,
    );

    await useCase.execute({
      userId: 'user-1',
      role: UserRole.User,
      title: 'T',
      docType: 'blog',
      scope: 'personal',
      sections: [],
    });

    expect(emit.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'template.created',
    ]);
  });

  const baseInput = {
    title: 'T',
    docType: 'blog',
    scope: 'personal',
    sections: [],
  };

  it("rejects scope 'global' from a non-admin with 403 and writes nothing", async () => {
    const repository = new InMemoryTemplateRepository();
    const useCase = new CreateTemplateUseCase(
      repository,
      emitter,
      DEFAULT_STORAGE_LIMITS,
    );

    await expect(
      useCase.execute({
        ...baseInput,
        userId: 'user-1',
        role: UserRole.User,
        scope: 'global',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(repository.createOptions).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("lets an admin create a 'global' template", async () => {
    const useCase = new CreateTemplateUseCase(
      new InMemoryTemplateRepository(),
      emitter,
      DEFAULT_STORAGE_LIMITS,
    );

    const template = await useCase.execute({
      ...baseInput,
      userId: 'admin-1',
      role: UserRole.Admin,
      scope: 'global',
    });

    expect(template.scope).toBe('global');
  });

  it('answers 409 once a non-admin holds the maximum number of templates', async () => {
    const useCase = new CreateTemplateUseCase(
      new InMemoryTemplateRepository(),
      emitter,
      { ...DEFAULT_STORAGE_LIMITS, maxTemplatesPerUser: 2 },
    );
    const input = { ...baseInput, userId: 'user-1', role: UserRole.User };
    await useCase.execute(input);
    await useCase.execute(input);
    emit.mockClear();

    const err: unknown = await useCase.execute(input).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(
      'Template limit reached (2)',
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('exempts admins from the template cap', async () => {
    const repository = new InMemoryTemplateRepository();
    const useCase = new CreateTemplateUseCase(repository, emitter, {
      ...DEFAULT_STORAGE_LIMITS,
      maxTemplatesPerUser: 1,
    });
    const input = { ...baseInput, userId: 'admin-1', role: UserRole.Admin };

    await useCase.execute(input);
    await useCase.execute(input);
    await expect(useCase.execute(input)).resolves.toBeDefined();
    expect(repository.createOptions.every((o) => o.maxPerUser === null)).toBe(
      true,
    );
  });
});
