import { ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '../../domain/users/user-role';
import { randomUUID } from 'node:crypto';
import { Template } from '../../domain/templates/template.entity';
import { TemplateSection } from '../../domain/templates/template-section.entity';
import {
  CreateTemplateData,
  TemplateRepository,
} from '../../domain/templates/template.repository';
import { CreateTemplateUseCase } from './create-template.use-case';

class InMemoryTemplateRepository implements TemplateRepository {
  private readonly templates: Template[] = [];

  create(data: CreateTemplateData): Promise<Template> {
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
    const useCase = new CreateTemplateUseCase(repository, emitter);

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
    const useCase = new CreateTemplateUseCase(repository, emitter);

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
    const useCase = new CreateTemplateUseCase(repository, emitter);

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
});
