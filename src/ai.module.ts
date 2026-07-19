import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenerateSuggestionUseCase } from './application/ai/generate-suggestion.use-case';
import { ListSuggestionsUseCase } from './application/ai/list-suggestions.use-case';
import { ReviewSuggestionUseCase } from './application/ai/review-suggestion.use-case';
import { AI_SUGGESTION_REPOSITORY } from './domain/ai/ai-suggestion.repository';
import { PROMPT_REPOSITORY } from './domain/ai/prompt.repository';
import {
  SUGGESTION_GENERATOR,
  SuggestionGenerator,
} from './domain/ai/suggestion-generator.port';
import { DocumentsModule } from './documents.module';
import { AnthropicClientProvider } from './infrastructure/ai/anthropic.client';
import { AnthropicSuggestionGenerator } from './infrastructure/ai/anthropic-suggestion-generator';
import { NullSuggestionGenerator } from './infrastructure/ai/null-suggestion-generator';
import { AiSuggestionOrmEntity } from './infrastructure/persistence/ai/ai-suggestion.orm-entity';
import { AiSuggestionTypeOrmRepository } from './infrastructure/persistence/ai/ai-suggestion.typeorm.repository';
import { PromptOrmEntity } from './infrastructure/persistence/ai/prompt.orm-entity';
import { PromptTypeOrmRepository } from './infrastructure/persistence/ai/prompt.typeorm.repository';
import { SuggestionReviewsController } from './presentation/ai/suggestion-reviews.controller';
import { SuggestionsController } from './presentation/ai/suggestions.controller';
import { UsersModule } from './users.module';

/**
 * Picks the real, Anthropic-backed generator once `ANTHROPIC_API_KEY` is
 * configured, and falls back to `NullSuggestionGenerator` otherwise — so
 * `start:dev`/smoke/e2e/tests keep working with no AI provider configured.
 * Mirrors `ContextModule.contextGathererFactory`. Exported (rather than
 * inlined in `providers`) so it has a direct unit test.
 */
export function suggestionGeneratorFactory(
  config: ConfigService,
  clientProvider: AnthropicClientProvider,
): SuggestionGenerator {
  return config.get<string>('ANTHROPIC_API_KEY')
    ? new AnthropicSuggestionGenerator(clientProvider)
    : new NullSuggestionGenerator();
}

/**
 * Roadmap item 5 — AI layer (PG side: `prompts` + `ai_suggestions`).
 * Imports `DocumentsModule` to reuse its exported `SECTION_REPOSITORY`/
 * `DOCUMENT_REPOSITORY` for the ownership checks in
 * `application/ai/section-access.ts` (same convention `TemplatesModule`
 * documents for depending on another feature's domain interfaces, not its
 * use-cases). Exports `AnthropicClientProvider` so `ContextModule` can wire
 * `AnthropicLlmPlanner` from the same client/config without a second
 * `Anthropic` instance.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PromptOrmEntity, AiSuggestionOrmEntity]),
    UsersModule,
    DocumentsModule,
  ],
  controllers: [SuggestionsController, SuggestionReviewsController],
  providers: [
    AnthropicClientProvider,
    { provide: PROMPT_REPOSITORY, useClass: PromptTypeOrmRepository },
    {
      provide: AI_SUGGESTION_REPOSITORY,
      useClass: AiSuggestionTypeOrmRepository,
    },
    {
      provide: SUGGESTION_GENERATOR,
      inject: [ConfigService, AnthropicClientProvider],
      useFactory: suggestionGeneratorFactory,
    },
    GenerateSuggestionUseCase,
    ListSuggestionsUseCase,
    ReviewSuggestionUseCase,
  ],
  exports: [
    AnthropicClientProvider,
    PROMPT_REPOSITORY,
    AI_SUGGESTION_REPOSITORY,
  ],
})
export class AiModule {}
