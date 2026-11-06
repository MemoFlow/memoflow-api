import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AiQuotaThrottledException } from '../../application/ai/ai-quota-http';
import { GenerateSuggestionUseCase } from '../../application/ai/generate-suggestion.use-case';
import { ListSuggestionsUseCase } from '../../application/ai/list-suggestions.use-case';
import { User } from '../../domain/users/user.entity';
import { AiConsentGuard } from '../auth/ai-consent.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';
import { SuggestionResponseDto } from './dto/suggestion-response.dto';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
@Controller('sections/:sectionId/suggestions')
export class SuggestionsController {
  constructor(
    private readonly generateSuggestionUseCase: GenerateSuggestionUseCase,
    private readonly listSuggestionsUseCase: ListSuggestionsUseCase,
  ) {}

  // Generating a suggestion calls the LLM provider (cost + provider rate
  // limits), so cap it tighter than the global default — 10/min per user IP.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AiConsentGuard)
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Generate an AI suggestion for a section' })
  @ApiResponse({ status: 201, type: SuggestionResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description:
      'AI consent missing or for an older notice (error: AI_CONSENT_REQUIRED), or email not verified',
  })
  @ApiResponse({
    status: 404,
    description:
      'Section not found (or not owned by the caller), or no active prompt configured for the feature type',
  })
  @ApiResponse({
    status: 422,
    description:
      'Section text exceeds the AI input limit (AI_MAX_INPUT_CHARS), or the model refused to answer',
  })
  @ApiResponse({
    status: 429,
    description:
      'Daily AI usage limit reached (per user or in total); see the Retry-After header (seconds until the next UTC midnight)',
  })
  @ApiResponse({
    status: 502,
    description:
      'The AI provider failed, was truncated, or returned an invalid or rejected response',
  })
  @ApiResponse({
    status: 503,
    description:
      'AI not configured, the provider is unavailable, or the usage counters are unreachable',
  })
  async create(
    @CurrentUser() user: User,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() dto: CreateSuggestionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SuggestionResponseDto> {
    let suggestion: Awaited<ReturnType<GenerateSuggestionUseCase['execute']>>;
    try {
      suggestion = await this.generateSuggestionUseCase.execute({
        userId: user.id,
        sectionId,
        featureType: dto.featureType,
      });
    } catch (err) {
      if (err instanceof AiQuotaThrottledException) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      throw err;
    }
    return SuggestionResponseDto.fromDomain(suggestion);
  }

  @Get()
  @ApiOperation({ summary: "List a section's AI suggestions, newest first" })
  @ApiResponse({ status: 200, type: [SuggestionResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Section not found' })
  async list(
    @CurrentUser() user: User,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<SuggestionResponseDto[]> {
    const suggestions = await this.listSuggestionsUseCase.execute({
      userId: user.id,
      sectionId,
    });
    return suggestions.map((suggestion) =>
      SuggestionResponseDto.fromDomain(suggestion),
    );
  }
}
