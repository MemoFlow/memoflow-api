import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { SuggestionStatus } from '../../../domain/ai/ai-suggestion.entity';

export class ReviewSuggestionDto {
  @ApiProperty({
    enum: [SuggestionStatus.Accepted, SuggestionStatus.Rejected],
  })
  @IsIn([SuggestionStatus.Accepted, SuggestionStatus.Rejected])
  status: SuggestionStatus.Accepted | SuggestionStatus.Rejected;
}
