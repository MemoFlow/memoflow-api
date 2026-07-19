import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { DocumentTemplate } from '../../domain/templates/document-template.entity';
import {
  ApplyToDocumentData,
  ApplyToDocumentResult,
  DocumentTemplateRepository,
} from '../../domain/templates/document-template.repository';
import { Template } from '../../domain/templates/template.entity';
import { TemplateSection } from '../../domain/templates/template-section.entity';
import { TemplateRepository } from '../../domain/templates/template.repository';
import { ApplyTemplateUseCase } from './apply-template.use-case';

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

// Simulates the atomic repository contract: sections + the document_templates
// row are produced together by a single call, so there is no partial-failure
// path for the use-case to worry about (that guarantee now lives in
// `DocumentTemplateTypeOrmRepository.applyToDocument`'s transaction).
class InMemoryDocumentTemplateRepository implements DocumentTemplateRepository {
  public applyToDocumentCalls: ApplyToDocumentData[] = [];

  applyToDocument(data: ApplyToDocumentData): Promise<ApplyToDocumentResult> {
    this.applyToDocumentCalls.push(data);
    return Promise.resolve({
      documentTemplate: new DocumentTemplate({
        id: randomUUID(),
        documentId: data.documentId,
        templateId: data.templateId,
        appliedAt: data.appliedAt,
        customised: false,
      }),
      sectionsCreated: data.sections.length,
    });
  }
}

class InMemoryDocumentRepository implements DocumentRepository {
  constructor(private readonly documents: Document[] = []) {}

  create(): Promise<Document> {
    return Promise.reject(new Error('not implemented'));
  }

  findById(id: string): Promise<Document | null> {
    return Promise.resolve(this.documents.find((d) => d.id === id) ?? null);
  }

  findByUser(): Promise<Document[]> {
    return Promise.reject(new Error('not implemented'));
  }

  update(): Promise<Document> {
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
    sections: [
      new TemplateSection({
        id: 'ts-2',
        templateId: 'template-1',
        title: 'Body',
        order: 1,
        wordCountMin: 100,
        wordCountMax: 500,
        isRequired: true,
      }),
      new TemplateSection({
        id: 'ts-1',
        templateId: 'template-1',
        title: 'Intro',
        order: 0,
        wordCountMin: 20,
        wordCountMax: 100,
        isRequired: true,
      }),
    ],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function makeDocument(overrides: Partial<Document> = {}): Document {
  return new Document({
    id: 'doc-1',
    userId: 'user-1',
    title: 'Q3 Planning',
    docType: 'blog',
    status: 'draft',
    styleConfig: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('ApplyTemplateUseCase', () => {
  it('delegates the ordered, content-defaulted sections and the join row to applyToDocument in one call', async () => {
    const templateRepository = new InMemoryTemplateRepository([makeTemplate()]);
    const documentTemplateRepository = new InMemoryDocumentTemplateRepository();
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const useCase = new ApplyTemplateUseCase(
      templateRepository,
      documentTemplateRepository,
      documentRepository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      templateId: 'template-1',
      documentId: 'doc-1',
    });

    expect(documentTemplateRepository.applyToDocumentCalls).toHaveLength(1);
    const call = documentTemplateRepository.applyToDocumentCalls[0];
    expect(call.documentId).toBe('doc-1');
    expect(call.templateId).toBe('template-1');
    expect(call.appliedAt).toBeInstanceOf(Date);
    expect(call.sections).toEqual([
      { title: 'Intro', content: '', status: 'draft', wordCount: 0 },
      { title: 'Body', content: '', status: 'draft', wordCount: 0 },
    ]);

    expect(result).toMatchObject({
      documentId: 'doc-1',
      templateId: 'template-1',
      sectionsCreated: 2,
    });
    expect(result.documentTemplateId).toEqual(expect.any(String));
    expect(result.appliedAt).toBeInstanceOf(Date);
  });

  it('throws NotFoundException when the template is not visible to the user', async () => {
    const templateRepository = new InMemoryTemplateRepository([
      makeTemplate({ isPublished: false, createdBy: 'user-2' }),
    ]);
    const useCase = new ApplyTemplateUseCase(
      templateRepository,
      new InMemoryDocumentTemplateRepository(),
      new InMemoryDocumentRepository([makeDocument()]),
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        templateId: 'template-1',
        documentId: 'doc-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the document is not owned by the user', async () => {
    const templateRepository = new InMemoryTemplateRepository([
      makeTemplate({ isPublished: true }),
    ]);
    const useCase = new ApplyTemplateUseCase(
      templateRepository,
      new InMemoryDocumentTemplateRepository(),
      new InMemoryDocumentRepository([makeDocument({ userId: 'user-2' })]),
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        templateId: 'template-1',
        documentId: 'doc-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
