import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivatePromptUseCase } from './application/ai/activate-prompt.use-case';
import { CreatePromptUseCase } from './application/ai/create-prompt.use-case';
import { GenerateSuggestionUseCase } from './application/ai/generate-suggestion.use-case';
import { ListSuggestionsUseCase } from './application/ai/list-suggestions.use-case';
import { ListPromptsUseCase } from './application/ai/list-prompts.use-case';
import { ReviewSuggestionUseCase } from './application/ai/review-suggestion.use-case';
import {
  AI_MAX_INPUT_CHARS,
  DEFAULT_AI_MAX_INPUT_CHARS,
} from './application/ai/max-input-chars.token';
import { AI_QUOTA, AiQuota } from './domain/ai/ai-quota.port';
import { AI_RESPONSE_CACHE } from './domain/ai/ai-response-cache.port';
import { AI_SUGGESTION_REPOSITORY } from './domain/ai/ai-suggestion.repository';
import { LLM_GATEWAY, LlmGateway } from './domain/ai/llm-gateway.port';
import { PROMPT_REPOSITORY } from './domain/ai/prompt.repository';
import {
  SUGGESTION_GENERATOR,
  SuggestionGenerator,
} from './domain/ai/suggestion-generator.port';
import { DocumentsModule } from './documents.module';
import { GatewaySuggestionGenerator } from './infrastructure/ai/gateway-suggestion-generator';
import { NullSuggestionGenerator } from './infrastructure/ai/null-suggestion-generator';
import { OpenRouterGateway } from './infrastructure/ai/openrouter.gateway';
import { RedisAiQuota } from './infrastructure/ai/redis-ai-quota';
import { RedisAiResponseCache } from './infrastructure/ai/redis-ai-response-cache';
import { AiSuggestionOrmEntity } from './infrastructure/persistence/ai/ai-suggestion.orm-entity';
import { AiSuggestionTypeOrmRepository } from './infrastructure/persistence/ai/ai-suggestion.typeorm.repository';
import { PromptOrmEntity } from './infrastructure/persistence/ai/prompt.orm-entity';
import { PromptTypeOrmRepository } from './infrastructure/persistence/ai/prompt.typeorm.repository';
import { PromptsController } from './presentation/ai/prompts.controller';
import { SuggestionReviewsController } from './presentation/ai/suggestion-reviews.controller';
import { SuggestionsController } from './presentation/ai/suggestions.controller';
import { UsersModule } from './users.module';

/**
 * Picks the real, gateway-backed generator once `OPENROUTER_API_KEY` is
 * configured, and falls back to `NullSuggestionGenerator` otherwise — so
 * `start:dev`/smoke/e2e/tests keep working with no AI provider configured.
 * Mirrors `ContextModule.contextGathererFactory`. Exported (rather than
 * inlined in `providers`) so it has a direct unit test.
 */
export function suggestionGeneratorFactory(
  config: ConfigService,
  gateway: LlmGateway,
  quota: AiQuota,
): SuggestionGenerator {
  return config.get<string>('OPENROUTER_API_KEY')
    ? new GatewaySuggestionGenerator(gateway, quota)
    : new NullSuggestionGenerator();
}

/** Resolves `AI_MAX_INPUT_CHARS` with its documented default. */
export function aiMaxInputCharsFactory(config: ConfigService): number {
  return config.get<number>('AI_MAX_INPUT_CHARS') ?? DEFAULT_AI_MAX_INPUT_CHARS;
}

/**
 * Roadmap item 5 — AI layer (PG side: `prompts` + `ai_suggestions`).
 * Imports `DocumentsModule` to reuse its exported `SECTION_REPOSITORY`/
 * `DOCUMENT_REPOSITORY` for the ownership checks in
 * `application/ai/section-access.ts` (same convention `TemplatesModule`
 * documents for depending on another feature's domain interfaces, not its
 * use-cases). Exports `LLM_GATEWAY` so `ContextModule` can wire
 * `GatewayLlmPlanner` on the same OpenRouter adapter.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PromptOrmEntity, AiSuggestionOrmEntity]),
    UsersModule,
    DocumentsModule,
  ],
  controllers: [
    SuggestionsController,
    SuggestionReviewsController,
    PromptsController,
  ],
  providers: [
    {
      provide: LLM_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmGateway =>
        new OpenRouterGateway(config),
    },
    { provide: PROMPT_REPOSITORY, useClass: PromptTypeOrmRepository },
    {
      provide: AI_SUGGESTION_REPOSITORY,
      useClass: AiSuggestionTypeOrmRepository,
    },
    { provide: AI_QUOTA, useClass: RedisAiQuota },
    { provide: AI_RESPONSE_CACHE, useClass: RedisAiResponseCache },
    {
      provide: SUGGESTION_GENERATOR,
      inject: [ConfigService, LLM_GATEWAY, AI_QUOTA],
      useFactory: suggestionGeneratorFactory,
    },
    {
      provide: AI_MAX_INPUT_CHARS,
      inject: [ConfigService],
      useFactory: aiMaxInputCharsFactory,
    },
    GenerateSuggestionUseCase,
    ListSuggestionsUseCase,
    ReviewSuggestionUseCase,
    ListPromptsUseCase,
    CreatePromptUseCase,
    ActivatePromptUseCase,
  ],
  exports: [LLM_GATEWAY, AI_QUOTA, PROMPT_REPOSITORY, AI_SUGGESTION_REPOSITORY],
})
export class AiModule {}
