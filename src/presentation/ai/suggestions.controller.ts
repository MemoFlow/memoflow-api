import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GenerateSuggestionUseCase } from '../../application/ai/generate-suggestion.use-case';
import { ListSuggestionsUseCase } from '../../application/ai/list-suggestions.use-case';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';
import { SuggestionResponseDto } from './dto/suggestion-response.dto';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sections/:sectionId/suggestions')
export class SuggestionsController {
  constructor(
    private readonly generateSuggestionUseCase: GenerateSuggestionUseCase,
    private readonly listSuggestionsUseCase: ListSuggestionsUseCase,
  ) {}

  // Generating a suggestion calls the LLM provider (cost + provider rate
  // limits), so cap it tighter than the global default — 10/min per user IP.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Generate an AI suggestion for a section' })
  @ApiResponse({ status: 201, type: SuggestionResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 404,
    description:
      'Section not found (or not owned by the caller), or no active prompt configured for the feature type',
  })
  @ApiResponse({ status: 503, description: 'AI not configured' })
  async create(
    @CurrentUser() user: User,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() dto: CreateSuggestionDto,
  ): Promise<SuggestionResponseDto> {
    const suggestion = await this.generateSuggestionUseCase.execute({
      userId: user.id,
      sectionId,
      featureType: dto.featureType,
    });
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
