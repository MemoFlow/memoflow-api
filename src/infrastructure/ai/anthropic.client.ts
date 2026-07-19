import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5';
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

/**
 * Thin provider around the Anthropic SDK client. Constructs `Anthropic`
 * lazily, only when `ANTHROPIC_API_KEY` is configured — a missing key must
 * never break boot (mirrors the lesson from Composio's required env vars:
 * an optional integration's config must stay optional at the `EnvironmentVariables`
 * level, see `env.validation.ts`). Callers check `isAvailable()` before
 * `getClient()`.
 */
@Injectable()
export class AnthropicClientProvider {
  private readonly client: Anthropic | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  getClient(): Anthropic {
    if (!this.client) {
      throw new Error(
        'Anthropic client requested without ANTHROPIC_API_KEY configured',
      );
    }
    return this.client;
  }

  getModel(): string {
    return (
      this.config.get<string>('ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_MODEL
    );
  }

  getMaxTokens(): number {
    return (
      this.config.get<number>('ANTHROPIC_MAX_TOKENS') ??
      DEFAULT_ANTHROPIC_MAX_TOKENS
    );
  }
}
