import { randomBytes } from 'node:crypto';
import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiSuggestion } from '../../domain/ai/ai-suggestion.entity';
import { AI_RESPONSE_CACHE } from '../../domain/ai/ai-response-cache.port';
import type { AiResponseCache } from '../../domain/ai/ai-response-cache.port';
import { AI_SUGGESTION_REPOSITORY } from '../../domain/ai/ai-suggestion.repository';
import type { AiSuggestionRepository } from '../../domain/ai/ai-suggestion.repository';
import {
  leaksPrompt,
  prepareUntrustedText,
} from '../../domain/ai/prompt-guards';
import { listPlaceholders, renderPrompt } from '../../domain/ai/prompt-render';
import type { Prompt } from '../../domain/ai/prompt.entity';
import { PROMPT_REPOSITORY } from '../../domain/ai/prompt.repository';
import type { PromptRepository } from '../../domain/ai/prompt.repository';
import {
  SuggestionGenerationProviderError,
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
import type { Section } from '../../domain/documents/section.entity';
import { SECTION_REPOSITORY } from '../../domain/documents/section.repository';
import type { SectionRepository } from '../../domain/documents/section.repository';
import {
  AI_MAX_INPUT_CHARS,
  DEFAULT_AI_MAX_INPUT_CHARS,
} from './max-input-chars.token';
import { quotaHttpException } from './ai-quota-http';
import { assertSectionOwnedByUser } from './section-access';
import { suggestionCacheKey } from './suggestion-cache-key';

/** Longest `suggested_text` accepted from the model. */
const MAX_SUGGESTED_TEXT_CHARS = 100_000;

/** Longest title shown in the light context. */
const MAX_CONTEXT_TITLE_CHARS = 200;

const oneLine = (title: string): string =>
  title.replace(/\s+/g, ' ').trim().slice(0, MAX_CONTEXT_TITLE_CHARS);

const GENERATION_FAILED_MESSAGE = 'AI suggestion generation failed';
const INVALID_OUTPUT_MESSAGE = 'The AI provider returned an invalid response';

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
 *    failure, 503 rate-limited/unavailable) instead of a bare 500; a spent
 *    daily quota is 429 with a retry hint, an unreachable one 503.
 *
 * Before the generator, the validated output of an identical earlier request
 * by the same user is looked up. A hit makes no provider call and uses no
 * quota; it still creates a normal `ai_suggestions` row.
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
    @Inject(AI_RESPONSE_CACHE)
    private readonly responseCache: AiResponseCache,
    @Optional()
    @Inject(AI_MAX_INPUT_CHARS)
    private readonly maxInputChars: number = DEFAULT_AI_MAX_INPUT_CHARS,
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

    if (section.content.length > this.maxInputChars) {
      throw new UnprocessableEntityException(
        `Section text is too long for AI processing (maximum ${this.maxInputChars} characters)`,
      );
    }

    // Fresh per request so document text can't predict the delimiter. The
    // text is redacted and fence tags neutralised for the model only; the
    // stored `originalText` stays the user's real text.
    const nonce = randomBytes(16).toString('hex');
    const light = await this.lightContext(prompt, section);
    const vars = {
      content: prepareUntrustedText(section.content),
      context: prepareUntrustedText(light.join('\n')),
      nonce,
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

    const source = [section.content, ...light].join('\n');
    const cacheKey = suggestionCacheKey({
      userId: input.userId,
      featureType: input.featureType,
      promptVersion: prompt.version,
      modelScope: this.suggestionGenerator.cacheScope(),
      content: vars.content,
      context: vars.context,
    });

    let generated: { suggestedText: string; model: string | null } | null =
      await this.responseCache.get(cacheKey);
    if (generated) {
      // A hit must not bypass validation. The nonce check is vacuous here
      // (this request's nonce was never shown to a model); shape, size and
      // the echo of the current system prompt are still checked. A failing
      // entry is ignored and the request goes to the model.
      try {
        this.assertValidOutput(generated.suggestedText, {
          nonce,
          system,
          source,
        });
      } catch {
        generated = null;
      }
    }

    if (!generated) {
      try {
        generated = await this.suggestionGenerator.generate({
          system,
          user,
          featureType: input.featureType,
          userId: input.userId,
        });
        this.assertValidOutput(generated.suggestedText, {
          nonce,
          system,
          source,
        });
      } catch (err) {
        throw this.mapGenerationError(err);
      }
      // Only output that passed validation is stored.
      await this.responseCache.set(cacheKey, {
        suggestedText: generated.suggestedText,
        model: generated.model,
      });
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

  /**
   * The light `{{context}}` for a section: its document's title and the
   * titles (only) of the previous and next sections. Skipped when the active
   * prompt does not use the placeholder, so older prompts cost nothing extra.
   * Uses the existing repositories; the section list is already ordered.
   */
  private async lightContext(
    prompt: Prompt,
    section: Section,
  ): Promise<string[]> {
    const usesContext = [prompt.systemTemplate, prompt.template].some(
      (template) => listPlaceholders(template).includes('context'),
    );
    if (!usesContext) return [];

    const [document, siblings] = await Promise.all([
      this.documentRepository.findById(section.documentId),
      this.sectionRepository.findTitlesByDocument(section.documentId),
    ]);
    const index = siblings.findIndex((s) => s.id === section.id);
    const lines: string[] = [];
    if (document) lines.push(`Document: ${oneLine(document.title)}`);
    if (index > 0) {
      lines.push(`Previous section: ${oneLine(siblings[index - 1].title)}`);
    }
    if (index >= 0 && index < siblings.length - 1) {
      lines.push(`Next section: ${oneLine(siblings[index + 1].title)}`);
    }
    return lines;
  }

  /** The reply is inert data: checked, stored, never executed or re-fed. */
  private assertValidOutput(
    text: unknown,
    leak: { nonce: string; system: string; source: string },
  ): void {
    if (
      typeof text !== 'string' ||
      text.trim() === '' ||
      text.length > MAX_SUGGESTED_TEXT_CHARS ||
      leaksPrompt(text, leak)
    ) {
      throw new SuggestionGenerationProviderError(INVALID_OUTPUT_MESSAGE);
    }
  }

  private mapGenerationError(err: unknown): Error {
    const quota = quotaHttpException(err);
    if (quota) return quota;
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
    if (err instanceof SuggestionGenerationProviderError) {
      return new BadGatewayException(err.message);
    }
    // An unexpected throw is an upstream fault. Its message may echo prompt
    // or provider text, so clients get a fixed one and logs only the name.
    this.logger.error(
      `Suggestion generation failed (${err instanceof Error ? err.name : 'unknown'})`,
    );
    return new BadGatewayException(GENERATION_FAILED_MESSAGE);
  }
}
