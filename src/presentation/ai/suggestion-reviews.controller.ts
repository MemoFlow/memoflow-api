import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ReviewSuggestionUseCase } from '../../application/ai/review-suggestion.use-case';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReviewSuggestionDto } from './dto/review-suggestion.dto';
import { SuggestionResponseDto } from './dto/suggestion-response.dto';

// Separate top-level `suggestions` resource controller (as opposed to
// SuggestionsController's section-scoped routes) since reviewing a
// suggestion is addressed by its own id, not its section's.
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('suggestions')
export class SuggestionReviewsController {
  constructor(
    private readonly reviewSuggestionUseCase: ReviewSuggestionUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'Accept or reject a pending AI suggestion' })
  @ApiResponse({ status: 200, type: SuggestionResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Suggestion not found' })
  @ApiResponse({
    status: 409,
    description: 'Suggestion has already been reviewed',
  })
  async review(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewSuggestionDto,
  ): Promise<SuggestionResponseDto> {
    const suggestion = await this.reviewSuggestionUseCase.execute({
      userId: user.id,
      suggestionId: id,
      status: dto.status,
    });
    return SuggestionResponseDto.fromDomain(suggestion);
  }
}
