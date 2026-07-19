import { Injectable } from '@nestjs/common';
import { SuggestionGeneratorUnavailableError } from '../../domain/ai/suggestion-generation.errors';
import {
  GenerateSuggestionOutput,
  SuggestionGenerator,
} from '../../domain/ai/suggestion-generator.port';

/**
 * Fallback `SuggestionGenerator` bound when `ANTHROPIC_API_KEY` is unset —
 * keeps `start:dev`/smoke/e2e/tests working with no AI provider configured.
 * `generate()` always throws so any caller that skips the `isAvailable()`
 * check still fails safely.
 */
@Injectable()
export class NullSuggestionGenerator implements SuggestionGenerator {
  isAvailable(): boolean {
    return false;
  }

  generate(): Promise<GenerateSuggestionOutput> {
    return Promise.reject(new SuggestionGeneratorUnavailableError());
  }
}
