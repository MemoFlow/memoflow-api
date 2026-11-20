import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/free';
const FETCH_TIMEOUT_MS = 5000;

export type FetchFn = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Best-effort startup check: with ZDR required, warns once per configured
 * model (primary and fallbacks) that has no zero-data-retention endpoint,
 * since routing will filter it out. Reads OpenRouter's public endpoint list
 * (no API key sent). Never blocks or fails boot, never runs under
 * `NODE_ENV=test`, and `fetch` is injectable so tests make no network call.
 */
@Injectable()
export class OpenRouterZdrCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(OpenRouterZdrCheck.name);

  constructor(
    private readonly config: ConfigService,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {}

  /** Not awaited: boot must not wait on a network call. */
  onApplicationBootstrap(): void {
    void this.check();
  }

  async check(): Promise<void> {
    try {
      if (this.config.get<string>('NODE_ENV') === 'test') return;
      if (!this.config.get<string>('OPENROUTER_API_KEY')) return;
      if (this.config.get<boolean>('OPENROUTER_REQUIRE_ZDR') === false) return;

      const baseUrl = (
        this.config.get<string>('OPENROUTER_BASE_URL') || DEFAULT_BASE_URL
      ).replace(/\/+$/, '');
      const models = [
        ...new Set([
          this.config.get<string>('OPENROUTER_MODEL') || DEFAULT_MODEL,
          ...(this.config.get<string>('OPENROUTER_FALLBACK_MODELS') ?? '')
            .split(',')
            .map((m) => m.trim())
            .filter((m) => m.length > 0),
        ]),
      ];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let body: unknown;
      try {
        const res = await this.fetchFn(`${baseUrl}/endpoints/zdr`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          this.logger.warn(
            `Could not check ZDR endpoints (HTTP ${res.status}); skipping`,
          );
          return;
        }
        body = await res.json();
      } finally {
        clearTimeout(timer);
      }

      const data = (body as { data?: unknown } | null)?.data;
      if (!Array.isArray(data)) {
        this.logger.warn('Could not check ZDR endpoints (unexpected response)');
        return;
      }
      const withZdr = new Set(
        data
          .map((e) => (e as { model_id?: unknown } | null)?.model_id)
          .filter((id): id is string => typeof id === 'string'),
      );
      for (const model of models) {
        // The gateway already warns about `openrouter/free` at construction.
        if (model === DEFAULT_MODEL) continue;
        if (!withZdr.has(model)) {
          this.logger.warn(
            `Model ${model} has no ZDR endpoint and will be filtered out by the ZDR routing preference; set OPENROUTER_REQUIRE_ZDR=false to allow it (prompts may then be logged or trained on)`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Could not check ZDR endpoints (${err instanceof Error ? err.name : 'unknown'}); skipping`,
      );
    }
  }
}
