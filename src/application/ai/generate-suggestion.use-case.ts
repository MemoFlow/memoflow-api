import {
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiSuggestion } from '../../domain/ai/ai-suggestion.entity';
import { AI_SUGGESTION_REPOSITORY } from '../../domain/ai/ai-suggestion.repository';
import type { AiSuggestionRepository } from '../../domain/ai/ai-suggestion.repository';
import { PROMPT_REPOSITORY } from '../../domain/ai/prompt.repository';
import type { PromptRepository } from '../../domain/ai/prompt.repository';
import {
  SuggestionGenerationRefusedError,
  SuggestionGenerationTruncatedError,
  SuggestionGeneratorRateLimitedError,
  SuggestionGeneratorUnavailableError,
} from '../../domain/ai/suggestion-generation.errors';
import { SUGGESTION_GENERATOR } from '../../domain/ai/suggestion-generator.port';
import type { SuggestionGenerator } from '../../domain/ai/suggestion-generator.port';
import { DOCUMENT_REPOSITORY } from '../../domain/documents/document.repository';
import type { DocumentRepository } from '../../domain/documents/document.repository';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import { assertSectionOwnedByUser } from './section-access';

export interface GenerateSuggestionInput {
  userId: string;
  sectionId: string;
  featureType: string;
}

/** Replaces every `{{content}}` placeholder in a prompt template. */
function renderPromptTemplate(template: string, content: string): string {
  return template.replace(/\{\{\s*content\s*\}\}/g, content);
}

/**
 * Generates (and persists) an AI suggestion for a section:
 * 1. the section must exist and its document be owned by the caller — 404;
 * 2. an active prompt for `featureType` must exist — 404;
 * 3. the generator must be available (an API key configured) — 503;
 * 4. the actual generation call is wrapped so typed provider errors map to
 *    the right HTTP status (422 refusal, 502 truncated/other provider
 *    failure, 503 rate-limited/unavailable) instead of a bare 500.
 */
@Injectable()
export class GenerateSuggestionUseCase {
  constructor(
    @Inject(SECTION_REPOSITORY)
    private readonly sectionRepository: SectionRepository,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
    @Inject(PROMPT_REPOSITORY)
    private readonly promptRepository: PromptRepository,
    @Inject(AI_SUGGESTION_REPOSITORY)
    private readonly aiSuggestionRepository: AiSuggestionRepository,
    @Inject(SUGGESTION_GENERATOR)
    private readonly suggestionGenerator: SuggestionGenerator,
  ) {}

  async execute(input: GenerateSuggestionInput): Promise<AiSuggestion> {
    const section = await assertSectionOwnedByUser(
      this.sectionRepository,
      this.documentRepository,
      input.userId,
      input.sectionId,
    );

    const prompt = await this.promptRepository.findActiveByFeatureType(
      input.featureType,
    );
    if (!prompt) {
      throw new NotFoundException(
        `No active prompt configured for feature type "${input.featureType}"`,
      );
    }

    if (!this.suggestionGenerator.isAvailable()) {
      throw new ServiceUnavailableException('AI not configured');
    }

    const renderedTemplate = renderPromptTemplate(
      prompt.template,
      section.content,
    );

    let generated: { suggestedText: string };
    try {
      generated = await this.suggestionGenerator.generate({
        promptTemplate: renderedTemplate,
        originalText: section.content,
        featureType: input.featureType,
      });
    } catch (err) {
      throw this.mapGenerationError(err);
    }

    return this.aiSuggestionRepository.create({
      sectionId: section.id,
      userId: input.userId,
      featureType: input.featureType,
      originalText: section.content,
      suggestedText: generated.suggestedText,
      promptVersion: prompt.version,
    });
  }

  private mapGenerationError(err: unknown): Error {
    if (err instanceof SuggestionGeneratorUnavailableError) {
      return new ServiceUnavailableException('AI not configured');
    }
    if (err instanceof SuggestionGenerationRefusedError) {
      return new UnprocessableEntityException(err.message);
    }
    if (err instanceof SuggestionGenerationTruncatedError) {
      return new BadGatewayException(err.message);
    }
    if (err instanceof SuggestionGeneratorRateLimitedError) {
      return new ServiceUnavailableException(
        err.retryAfterSeconds
          ? `${err.message} (retry after ${err.retryAfterSeconds}s)`
          : err.message,
      );
    }
    // Any other provider failure (SuggestionGenerationProviderError or an
    // unexpected throw) is treated as an upstream fault.
    return new BadGatewayException(
      err instanceof Error ? err.message : 'AI suggestion generation failed',
    );
  }
}
