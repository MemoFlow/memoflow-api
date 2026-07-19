import { NotFoundException } from '@nestjs/common';
import {
  AiSuggestion,
  SuggestionStatus,
} from '../../domain/ai/ai-suggestion.entity';
import { AiSuggestionRepository } from '../../domain/ai/ai-suggestion.repository';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { Section } from '../../domain/documents/section.entity';
import { SectionRepository } from '../../domain/documents/section.repository';
import { ListSuggestionsUseCase } from './list-suggestions.use-case';

class InMemorySectionRepository implements SectionRepository {
  constructor(private readonly sections: Section[] = []) {}
  create(): Promise<Section> {
    return Promise.reject(new Error('not implemented'));
  }
  findById(id: string): Promise<Section | null> {
    return Promise.resolve(this.sections.find((s) => s.id === id) ?? null);
  }
  findByDocument(): Promise<Section[]> {
    return Promise.reject(new Error('not implemented'));
  }
  update(): Promise<Section> {
    return Promise.reject(new Error('not implemented'));
  }
  delete(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
  maxOrder(): Promise<number | null> {
    return Promise.reject(new Error('not implemented'));
  }
  reorder(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
  replaceAll(): Promise<number> {
    return Promise.reject(new Error('not implemented'));
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

class InMemoryAiSuggestionRepository implements AiSuggestionRepository {
  constructor(private readonly suggestions: AiSuggestion[] = []) {}
  create(): Promise<AiSuggestion> {
    return Promise.reject(new Error('not implemented'));
  }
  findById(): Promise<AiSuggestion | null> {
    return Promise.reject(new Error('not implemented'));
  }
  findBySectionId(sectionId: string): Promise<AiSuggestion[]> {
    return Promise.resolve(
      this.suggestions.filter((s) => s.sectionId === sectionId),
    );
  }
  markReviewed(): Promise<AiSuggestion | null> {
    return Promise.reject(new Error('not implemented'));
  }
}

function makeSection(overrides: Partial<Section> = {}): Section {
  return new Section({
    id: 'section-1',
    documentId: 'doc-1',
    title: 'Intro',
    content: 'Hello world',
    order: 0,
    status: 'draft',
    wordCount: 2,
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

function makeSuggestion(overrides: Partial<AiSuggestion> = {}): AiSuggestion {
  return new AiSuggestion({
    id: 'suggestion-1',
    sectionId: 'section-1',
    userId: 'user-1',
    featureType: 'suggestion',
    originalText: 'Hello world',
    suggestedText: 'Hello, world!',
    status: SuggestionStatus.Pending,
    promptVersion: 'v1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('ListSuggestionsUseCase', () => {
  it('returns suggestions for a section owned by the user', async () => {
    const sectionRepository = new InMemorySectionRepository([makeSection()]);
    const documentRepository = new InMemoryDocumentRepository([makeDocument()]);
    const aiSuggestionRepository = new InMemoryAiSuggestionRepository([
      makeSuggestion(),
    ]);
    const useCase = new ListSuggestionsUseCase(
      sectionRepository,
      documentRepository,
      aiSuggestionRepository,
    );

    const result = await useCase.execute({
      userId: 'user-1',
      sectionId: 'section-1',
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('suggestion-1');
  });

  it('404s when the section does not exist', async () => {
    const useCase = new ListSuggestionsUseCase(
      new InMemorySectionRepository([]),
      new InMemoryDocumentRepository([makeDocument()]),
      new InMemoryAiSuggestionRepository([]),
    );

    await expect(
      useCase.execute({ userId: 'user-1', sectionId: 'missing' }),
    ).rejects.toThrow(NotFoundException);
  });

  it("404s when the section's document belongs to another user", async () => {
    const useCase = new ListSuggestionsUseCase(
      new InMemorySectionRepository([makeSection()]),
      new InMemoryDocumentRepository([makeDocument({ userId: 'user-2' })]),
      new InMemoryAiSuggestionRepository([]),
    );

    await expect(
      useCase.execute({ userId: 'user-1', sectionId: 'section-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
