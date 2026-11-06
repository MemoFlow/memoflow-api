import { randomBytes } from 'node:crypto';
import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiSuggestion } from '../../domain/ai/ai-suggestion.entity';
import { AI_SUGGESTION_REPOSITORY } from '../../domain/ai/ai-suggestion.repository';
import type { AiSuggestionRepository } from '../../domain/ai/ai-suggestion.repository';
import { renderPrompt } from '../../domain/ai/prompt-render';
import { PROMPT_REPOSITORY } from '../../domain/ai/prompt.repository';
import type { PromptRepository } from '../../domain/ai/prompt.repository';
import {
  SuggestionGenerationRefusedError,
  SuggestionGenerationTruncatedError,
  SuggestionGeneratorRateLimitedError,
  SUGGESTION_GENERATOR_NOT_CONFIGURED_MESSAGE,
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

/**
 * Generates (and persists) an AI suggestion for a section:
 * 1. the section must exist and its document be owned by the caller — 404;
 * 2. an active, user-invocable prompt for `featureType` must exist — 404
 *    (the same message when the prompt is internal, e.g. `planning`, so a
 *    client can't tell it exists);
 * 3. the generator must be available (an API key configured) — 503;
 * 4. the actual generation call is wrapped so typed provider errors map to
 *    the right HTTP status (422 refusal, 502 truncated/other provider
 *    failure, 503 rate-limited/unavailable) instead of a bare 500.
 */
@Injectable()
export class GenerateSuggestionUseCase {
  private readonly logger = new Logger(GenerateSuggestionUseCase.name);

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
    if (!prompt || !prompt.userInvocable) {
      throw new NotFoundException(
        `No active prompt configured for feature type "${input.featureType}"`,
      );
    }

    if (!this.suggestionGenerator.isAvailable()) {
      throw new ServiceUnavailableException('AI not configured');
    }

    // Fresh per request so document text can't predict the delimiter.
    const vars = {
      content: section.content,
      nonce: randomBytes(16).toString('hex'),
    };
    let system: string;
    let user: string;
    try {
      system = renderPrompt(prompt.systemTemplate, vars);
      user = renderPrompt(prompt.template, vars);
    } catch {
      // Only metadata is logged: the error text may echo template content.
      this.logger.error(
        `Active prompt cannot be rendered (feature_type=${prompt.featureType}, version=${prompt.version})`,
      );
      throw new ServiceUnavailableException('AI prompt is misconfigured');
    }

    let generated: { suggestedText: string; model: string | null };
    try {
      generated = await this.suggestionGenerator.generate({
        system,
        user,
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
      model: generated.model,
    });
  }

  private mapGenerationError(err: unknown): Error {
    if (err instanceof SuggestionGeneratorUnavailableError) {
      return new ServiceUnavailableException(
        err.message === SUGGESTION_GENERATOR_NOT_CONFIGURED_MESSAGE
          ? 'AI not configured'
          : err.message,
      );
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
