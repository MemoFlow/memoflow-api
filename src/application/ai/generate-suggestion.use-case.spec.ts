import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AiSuggestion,
  SuggestionStatus,
} from '../../domain/ai/ai-suggestion.entity';
import {
  AiSuggestionRepository,
  CreateAiSuggestionData,
} from '../../domain/ai/ai-suggestion.repository';
import { Prompt } from '../../domain/ai/prompt.entity';
import {
  SuggestionGenerationRefusedError,
  SuggestionGenerationTruncatedError,
  SuggestionGeneratorRateLimitedError,
  SuggestionGeneratorUnavailableError,
} from '../../domain/ai/suggestion-generation.errors';
import {
  GenerateSuggestionInput as GeneratorInput,
  SuggestionGenerator,
} from '../../domain/ai/suggestion-generator.port';
import { Document } from '../../domain/documents/document.entity';
import { DocumentRepository } from '../../domain/documents/document.repository';
import { Section } from '../../domain/documents/section.entity';
import { SectionRepository } from '../../domain/documents/section.repository';
import { GenerateSuggestionUseCase } from './generate-suggestion.use-case';
import { InMemoryPromptRepository, makePrompt } from './testing-fakes';

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
  public created: CreateAiSuggestionData[] = [];
  create(data: CreateAiSuggestionData): Promise<AiSuggestion> {
    this.created.push(data);
    return Promise.resolve(
      new AiSuggestion({
        id: 'suggestion-1',
        ...data,
        status: SuggestionStatus.Pending,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
  }
  findById(): Promise<AiSuggestion | null> {
    return Promise.reject(new Error('not implemented'));
  }
  findBySectionId(): Promise<AiSuggestion[]> {
    return Promise.reject(new Error('not implemented'));
  }
  markReviewed(): Promise<AiSuggestion | null> {
    return Promise.reject(new Error('not implemented'));
  }
}

class FakeSuggestionGenerator implements SuggestionGenerator {
  public calls: GeneratorInput[] = [];
  public available = true;
  public error: Error | null = null;
  public result: { suggestedText: string; model: string | null } = {
    suggestedText: 'Better text.',
    model: 'test/model-1',
  };

  isAvailable(): boolean {
    return this.available;
  }

  generate(
    input: GeneratorInput,
  ): Promise<{ suggestedText: string; model: string | null }> {
    this.calls.push(input);
    if (this.error) {
      return Promise.reject(this.error);
    }
    return Promise.resolve(this.result);
  }
}

function makeSection(overrides: Partial<Section> = {}): Section {
  return new Section({
    id: 'section-1',
    documentId: 'doc-1',
    title: 'Intro',
    content: 'Original content',
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

describe('GenerateSuggestionUseCase', () => {
  function build(opts: {
    sections?: Section[];
    documents?: Document[];
    prompts?: Prompt[];
  }) {
    const sectionRepository = new InMemorySectionRepository(opts.sections);
    const documentRepository = new InMemoryDocumentRepository(opts.documents);
    const promptRepository = new InMemoryPromptRepository(opts.prompts);
    const aiSuggestionRepository = new InMemoryAiSuggestionRepository();
    const generator = new FakeSuggestionGenerator();
    const useCase = new GenerateSuggestionUseCase(
      sectionRepository,
      documentRepository,
      promptRepository,
      aiSuggestionRepository,
      generator,
    );
    return { useCase, aiSuggestionRepository, generator };
  }

  it('renders system and user templates, persists the suggestion with its model', async () => {
    const { useCase, aiSuggestionRepository, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [makePrompt()],
    });

    const result = await useCase.execute({
      userId: 'user-1',
      sectionId: 'section-1',
      featureType: 'suggestion',
    });

    expect(generator.calls).toHaveLength(1);
    const [call] = generator.calls;
    const nonce = /^System <untrusted_([0-9a-f]{32})>$/.exec(call.system)?.[1];
    expect(nonce).toBeDefined();
    expect(call.user).toBe('Improve this: Original content');
    expect(call.featureType).toBe('suggestion');
    expect(aiSuggestionRepository.created).toEqual([
      {
        sectionId: 'section-1',
        userId: 'user-1',
        featureType: 'suggestion',
        originalText: 'Original content',
        suggestedText: 'Better text.',
        promptVersion: 'v1',
        model: 'test/model-1',
      },
    ]);
    expect(result.suggestedText).toBe('Better text.');
    expect(result.model).toBe('test/model-1');
  });

  it('503s with a fixed message when the active prompt cannot be rendered', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [makePrompt({ template: 'Bad {{foo}} {{content}}' })],
    });

    const err = await useCase
      .execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType: 'suggestion',
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).message).toBe(
      'AI prompt is misconfigured',
    );
    expect(generator.calls).toHaveLength(0);
  });

  it('uses a fresh nonce per request, shared by both templates', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [
        makePrompt({
          systemTemplate: 'S {{nonce}}',
          template: 'U {{nonce}} {{content}}',
        }),
      ],
    });
    const input = {
      userId: 'user-1',
      sectionId: 'section-1',
      featureType: 'suggestion',
    };

    await useCase.execute(input);
    await useCase.execute(input);

    const [a, b] = generator.calls;
    const nonceA = a.system.slice(2);
    expect(a.user).toBe(`U ${nonceA} Original content`);
    expect(b.system.slice(2)).not.toBe(nonceA);
  });

  it('keeps $-sequences and placeholders in the content literal', async () => {
    const content = 'costs $& and $1 and {{content}}';
    const { useCase, generator } = build({
      sections: [makeSection({ content })],
      documents: [makeDocument()],
      prompts: [makePrompt()],
    });

    await useCase.execute({
      userId: 'user-1',
      sectionId: 'section-1',
      featureType: 'suggestion',
    });

    expect(generator.calls[0].user).toBe(`Improve this: ${content}`);
  });

  it('gives planning and an unknown type the same 404, without calling the generator', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [
        makePrompt({
          id: 'p-planning',
          featureType: 'planning',
          userInvocable: false,
        }),
      ],
    });
    const run = (featureType: string) =>
      useCase.execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType,
      });

    const planning = await run('planning').catch((e: unknown) => e);
    const unknown = await run('does-not-exist').catch((e: unknown) => e);

    expect(planning).toBeInstanceOf(NotFoundException);
    expect(unknown).toBeInstanceOf(NotFoundException);
    expect(
      (planning as NotFoundException).message.replace('planning', 'X'),
    ).toBe(
      (unknown as NotFoundException).message.replace('does-not-exist', 'X'),
    );
    expect(generator.calls).toHaveLength(0);
  });

  it('404s when the section does not exist', async () => {
    const { useCase } = build({ documents: [makeDocument()] });

    await expect(
      useCase.execute({
        userId: 'user-1',
        sectionId: 'missing',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("404s when the section's document belongs to another user", async () => {
    const { useCase } = build({
      sections: [makeSection()],
      documents: [makeDocument({ userId: 'user-2' })],
    });

    await expect(
      useCase.execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s when no active prompt is configured for the feature type', async () => {
    const { useCase } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [],
    });

    await expect(
      useCase.execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('503s when the generator is unavailable (no API key configured)', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [makePrompt()],
    });
    generator.available = false;

    await expect(
      useCase.execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('422s on a model refusal', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [makePrompt()],
    });
    generator.error = new SuggestionGenerationRefusedError();

    await expect(
      useCase.execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('502s when the response was truncated (max_tokens)', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [makePrompt()],
    });
    generator.error = new SuggestionGenerationTruncatedError();

    await expect(
      useCase.execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(BadGatewayException);
  });

  it('503s when the provider is rate-limited', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [makePrompt()],
    });
    generator.error = new SuggestionGeneratorRateLimitedError(
      'Rate limited',
      30,
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('503s when generate() itself throws SuggestionGeneratorUnavailableError', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [makePrompt()],
    });
    generator.error = new SuggestionGeneratorUnavailableError();

    await expect(
      useCase.execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('reports "AI not configured" when generate() throws the default unavailable error', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [makePrompt()],
    });
    generator.error = new SuggestionGeneratorUnavailableError();

    await expect(
      useCase.execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow('AI not configured');
  });

  it('surfaces the outage message when the provider is temporarily unavailable', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [makePrompt()],
    });
    generator.error = new SuggestionGeneratorUnavailableError(
      'AI provider temporarily unavailable',
    );

    const result = useCase.execute({
      userId: 'user-1',
      sectionId: 'section-1',
      featureType: 'suggestion',
    });
    await expect(result).rejects.toThrow(ServiceUnavailableException);
    await expect(result).rejects.toThrow('AI provider temporarily unavailable');
  });

  it('502s on an unexpected provider error', async () => {
    const { useCase, generator } = build({
      sections: [makeSection()],
      documents: [makeDocument()],
      prompts: [makePrompt()],
    });
    generator.error = new Error('boom');

    await expect(
      useCase.execute({
        userId: 'user-1',
        sectionId: 'section-1',
        featureType: 'suggestion',
      }),
    ).rejects.toThrow(BadGatewayException);
  });
});
