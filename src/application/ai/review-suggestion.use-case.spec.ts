import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AiSuggestion,
  SuggestionStatus,
} from '../../domain/ai/ai-suggestion.entity';
import { AiSuggestionRepository } from '../../domain/ai/ai-suggestion.repository';
import { SUGGESTION_REVIEWED_EVENT } from '../../domain/audit/audit-events';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { Section } from '../../domain/documents/section.entity';
import { SectionRepository } from '../../domain/documents/section.repository';
import { ReviewSuggestionUseCase } from './review-suggestion.use-case';

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
  public markReviewedCalls: { id: string; status: SuggestionStatus }[] = [];
  /**
   * Test hook: forces `markReviewed` to return `null` regardless of
   * in-memory state — simulates the atomic conditional update losing a race
   * against a concurrent review that happened between the use-case's
   * pre-read and this call.
   */
  public forceMarkReviewedNull = false;

  constructor(private readonly suggestions: AiSuggestion[] = []) {}

  create(): Promise<AiSuggestion> {
    return Promise.reject(new Error('not implemented'));
  }
  findById(id: string): Promise<AiSuggestion | null> {
    return Promise.resolve(this.suggestions.find((s) => s.id === id) ?? null);
  }
  findBySectionId(): Promise<AiSuggestion[]> {
    return Promise.reject(new Error('not implemented'));
  }
  markReviewed(
    id: string,
    status: SuggestionStatus,
  ): Promise<AiSuggestion | null> {
    this.markReviewedCalls.push({ id, status });
    if (this.forceMarkReviewedNull) {
      return Promise.resolve(null);
    }
    const index = this.suggestions.findIndex((s) => s.id === id);
    if (
      index === -1 ||
      this.suggestions[index].status !== SuggestionStatus.Pending
    ) {
      // Conditional-update semantics: only a `pending` row transitions.
      return Promise.resolve(null);
    }
    const updated = new AiSuggestion({ ...this.suggestions[index], status });
    this.suggestions[index] = updated;
    return Promise.resolve(updated);
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

function makeEventEmitter(): jest.Mocked<Pick<EventEmitter2, 'emit'>> {
  return { emit: jest.fn() };
}

describe('ReviewSuggestionUseCase', () => {
  function build(opts: {
    suggestions?: AiSuggestion[];
    sections?: Section[];
    documents?: Document[];
  }) {
    const aiSuggestionRepository = new InMemoryAiSuggestionRepository(
      opts.suggestions,
    );
    const sectionRepository = new InMemorySectionRepository(opts.sections);
    const documentRepository = new InMemoryDocumentRepository(opts.documents);
    const eventEmitter = makeEventEmitter();
    const useCase = new ReviewSuggestionUseCase(
      aiSuggestionRepository,
      sectionRepository,
      documentRepository,
      eventEmitter as unknown as EventEmitter2,
    );
    return { useCase, aiSuggestionRepository, eventEmitter };
  }

  it('accepts a pending suggestion and emits suggestion.reviewed', async () => {
    const { useCase, aiSuggestionRepository, eventEmitter } = build({
      suggestions: [makeSuggestion()],
      sections: [makeSection()],
      documents: [makeDocument()],
    });

    const result = await useCase.execute({
      userId: 'user-1',
      suggestionId: 'suggestion-1',
      status: SuggestionStatus.Accepted,
    });

    expect(result.status).toBe(SuggestionStatus.Accepted);
    expect(aiSuggestionRepository.markReviewedCalls).toEqual([
      { id: 'suggestion-1', status: SuggestionStatus.Accepted },
    ]);
    expect(eventEmitter.emit).toHaveBeenCalledWith(SUGGESTION_REVIEWED_EVENT, {
      userId: 'user-1',
      suggestionId: 'suggestion-1',
      decision: SuggestionStatus.Accepted,
    });
  });

  it('rejects a pending suggestion and emits suggestion.reviewed with decision=rejected', async () => {
    const { useCase, eventEmitter } = build({
      suggestions: [makeSuggestion()],
      sections: [makeSection()],
      documents: [makeDocument()],
    });

    const result = await useCase.execute({
      userId: 'user-1',
      suggestionId: 'suggestion-1',
      status: SuggestionStatus.Rejected,
    });

    expect(result.status).toBe(SuggestionStatus.Rejected);
    expect(eventEmitter.emit).toHaveBeenCalledWith(SUGGESTION_REVIEWED_EVENT, {
      userId: 'user-1',
      suggestionId: 'suggestion-1',
      decision: SuggestionStatus.Rejected,
    });
  });

  it('404s when the suggestion does not exist', async () => {
    const { useCase } = build({});

    await expect(
      useCase.execute({
        userId: 'user-1',
        suggestionId: 'missing',
        status: SuggestionStatus.Accepted,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("404s when the suggestion's section belongs to another user's document", async () => {
    const { useCase } = build({
      suggestions: [makeSuggestion()],
      sections: [makeSection()],
      documents: [makeDocument({ userId: 'user-2' })],
    });

    await expect(
      useCase.execute({
        userId: 'user-1',
        suggestionId: 'suggestion-1',
        status: SuggestionStatus.Accepted,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('409s when the suggestion has already been reviewed (fast-path, no write attempted)', async () => {
    const { useCase, aiSuggestionRepository } = build({
      suggestions: [makeSuggestion({ status: SuggestionStatus.Accepted })],
      sections: [makeSection()],
      documents: [makeDocument()],
    });

    await expect(
      useCase.execute({
        userId: 'user-1',
        suggestionId: 'suggestion-1',
        status: SuggestionStatus.Rejected,
      }),
    ).rejects.toThrow(ConflictException);
    expect(aiSuggestionRepository.markReviewedCalls).toHaveLength(0);
  });

  it('409s when the atomic conditional update loses a race, even though the pre-read saw pending', async () => {
    const { useCase, aiSuggestionRepository } = build({
      suggestions: [makeSuggestion({ status: SuggestionStatus.Pending })],
      sections: [makeSection()],
      documents: [makeDocument()],
    });
    // Simulates a concurrent reviewer winning between this use-case's
    // pre-read and its markReviewed call — the in-memory fast-path check
    // alone would incorrectly allow this through as 200.
    aiSuggestionRepository.forceMarkReviewedNull = true;

    await expect(
      useCase.execute({
        userId: 'user-1',
        suggestionId: 'suggestion-1',
        status: SuggestionStatus.Accepted,
      }),
    ).rejects.toThrow(ConflictException);
    expect(aiSuggestionRepository.markReviewedCalls).toEqual([
      { id: 'suggestion-1', status: SuggestionStatus.Accepted },
    ]);
  });
});
