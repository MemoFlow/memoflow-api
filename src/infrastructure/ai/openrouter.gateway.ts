import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmCompletion,
  LlmCompletionRequest,
  LlmGateway,
  LlmUsage,
} from '../../domain/ai/llm-gateway.port';
import {
  SuggestionGenerationProviderError,
  SuggestionGenerationRefusedError,
  SuggestionGenerationTruncatedError,
  SuggestionGeneratorRateLimitedError,
  SuggestionGeneratorUnavailableError,
} from '../../domain/ai/suggestion-generation.errors';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/free';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;

/** Fixed outage message; the use-case surfaces it to clients as-is. */
const UNAVAILABLE_MESSAGE = 'AI provider temporarily unavailable';

const REPAIR_INSTRUCTION =
  'Your previous reply was not valid JSON. Reply again with ONLY the JSON object that satisfies the schema: no prose, no markdown, no code fences.';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponseBody {
  model?: unknown;
  error?: { code?: unknown; message?: unknown };
  choices?: Array<{
    finish_reason?: unknown;
    error?: { code?: unknown; message?: unknown };
    message?: { content?: unknown };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

interface RawCompletion {
  content: string;
  model: string;
  finishReason: string;
  usage?: LlmUsage;
}

/**
 * The single `LlmGateway` adapter: OpenRouter's OpenAI-compatible
 * `/chat/completions` over native `fetch`. Config is read lazily so a missing
 * key never breaks boot. Never logs prompts, replies or the API key, and
 * never puts raw provider text in thrown messages (the use-case surfaces
 * those to clients).
 */
@Injectable()
export class OpenRouterGateway implements LlmGateway {
  private readonly logger = new Logger(OpenRouterGateway.name);

  constructor(private readonly config: ConfigService) {}

  isAvailable(): boolean {
    return Boolean(this.config.get<string>('OPENROUTER_API_KEY'));
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    if (!this.isAvailable()) {
      throw new SuggestionGeneratorUnavailableError();
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ];

    // One deadline bounds the whole call, repair retry included.
    const deadline = Date.now() + this.timeoutMs();

    const first = await this.callOnce(request, messages, deadline);
    const parsedFirst = parseJsonContent(first.content);
    if (parsedFirst.ok) return toCompletion(first, parsedFirst.value);

    // One repair retry only.
    this.logger.warn(
      `OpenRouter reply was not valid JSON (model=${first.model}); retrying once`,
    );
    if (deadline - Date.now() <= 0) {
      this.logger.error('OpenRouter time budget exhausted; repair skipped');
      throw new SuggestionGenerationProviderError(
        'The AI provider returned an invalid response',
      );
    }
    const second = await this.callOnce(
      request,
      [
        ...messages,
        { role: 'assistant', content: first.content },
        { role: 'user', content: REPAIR_INSTRUCTION },
      ],
      deadline,
    );
    second.usage = sumUsage(first.usage, second.usage);
    const parsedSecond = parseJsonContent(second.content);
    if (parsedSecond.ok) return toCompletion(second, parsedSecond.value);

    this.logger.error(
      `OpenRouter reply was not valid JSON after repair retry (model=${second.model})`,
    );
    throw new SuggestionGenerationProviderError(
      'The AI provider returned an invalid response',
    );
  }

  private timeoutMs(): number {
    return (
      this.config.get<number>('OPENROUTER_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS
    );
  }

  private async callOnce(
    request: LlmCompletionRequest,
    messages: ChatMessage[],
    deadline: number,
  ): Promise<RawCompletion> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    const baseUrl = (
      this.config.get<string>('OPENROUTER_BASE_URL') || DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    const model = this.config.get<string>('OPENROUTER_MODEL') || DEFAULT_MODEL;
    const fallbacks = parseModelList(
      this.config.get<string>('OPENROUTER_FALLBACK_MODELS'),
    );
    const maxTokens =
      request.maxTokens ??
      this.config.get<number>('OPENROUTER_MAX_TOKENS') ??
      DEFAULT_MAX_TOKENS;

    const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.jsonSchema.name,
          strict: true,
          schema: request.jsonSchema.schema,
        },
      },
    };
    if (fallbacks.length > 0) {
      body.models = [model, ...fallbacks.filter((m) => m !== model)];
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw this.networkFailure(err);
    }

    if (!response.ok) {
      // Mapped from the status alone: the body is never needed, so a failed
      // or hung body read can't change the classification.
      response.body?.cancel().catch(() => undefined);
      throw this.mapStatus(
        response.status,
        response.headers.get('retry-after'),
        'http',
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      throw this.networkFailure(err);
    }

    let parsed: ChatResponseBody;
    try {
      parsed = JSON.parse(text) as ChatResponseBody;
    } catch {
      this.logger.error('OpenRouter returned a non-JSON response body');
      throw new SuggestionGenerationProviderError(
        'The AI provider returned an invalid response',
      );
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new SuggestionGenerationProviderError(
        'The AI provider returned an invalid response',
      );
    }

    // OpenRouter can report failures as an `error` object inside HTTP 200.
    if (parsed.error) {
      throw this.mapStatus(toStatus(parsed.error.code), null, 'body');
    }

    const choice = parsed.choices?.[0];
    if (!choice) {
      this.logger.error('OpenRouter response had no choices');
      throw new SuggestionGenerationProviderError(
        'The AI provider returned an empty response',
      );
    }
    if (choice.error) {
      throw this.mapStatus(toStatus(choice.error.code), null, 'choice');
    }

    const finishReason =
      typeof choice.finish_reason === 'string' ? choice.finish_reason : '';
    const resolvedModel =
      typeof parsed.model === 'string' && parsed.model ? parsed.model : model;
    if (finishReason === 'length') {
      throw new SuggestionGenerationTruncatedError();
    }
    if (finishReason === 'content_filter') {
      throw new SuggestionGenerationRefusedError();
    }

    const content = choice.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      this.logger.error(
        `OpenRouter response had empty content (model=${resolvedModel}, finish_reason=${finishReason})`,
      );
      throw new SuggestionGenerationProviderError(
        'The AI provider returned an empty response',
      );
    }

    return {
      content,
      model: resolvedModel,
      finishReason,
      usage: toUsage(parsed.usage),
    };
  }

  private networkFailure(err: unknown): Error {
    const name = err instanceof Error ? err.name : 'unknown';
    this.logger.error(`OpenRouter request failed (${name})`);
    return new SuggestionGeneratorUnavailableError(UNAVAILABLE_MESSAGE);
  }

  private mapStatus(
    status: number | undefined,
    retryAfter: string | null,
    origin: string,
  ): Error {
    this.logger.error(
      `OpenRouter error (origin=${origin}, status=${status ?? 'unknown'})`,
    );
    if (status === 429) {
      return new SuggestionGeneratorRateLimitedError(
        'The AI provider is rate-limited',
        parseRetryAfter(retryAfter),
      );
    }
    if (status === 408 || (status !== undefined && status >= 500)) {
      return new SuggestionGeneratorUnavailableError(UNAVAILABLE_MESSAGE);
    }
    return new SuggestionGenerationProviderError();
  }
}

function toCompletion(raw: RawCompletion, json: unknown): LlmCompletion {
  return {
    json,
    model: raw.model,
    finishReason: raw.finishReason,
    ...(raw.usage ? { usage: raw.usage } : {}),
  };
}

function toStatus(code: unknown): number | undefined {
  const n = typeof code === 'string' ? Number(code) : code;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function toUsage(usage: ChatResponseBody['usage']): LlmUsage | undefined {
  if (!usage) return undefined;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const result: LlmUsage = {
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    totalTokens: num(usage.total_tokens),
  };
  return Object.values(result).some((v) => v !== undefined)
    ? result
    : undefined;
}

function sumUsage(
  a: LlmUsage | undefined,
  b: LlmUsage | undefined,
): LlmUsage | undefined {
  if (!a && !b) return undefined;
  const add = (x?: number, y?: number): number | undefined =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  return {
    promptTokens: add(a?.promptTokens, b?.promptTokens),
    completionTokens: add(a?.completionTokens, b?.completionTokens),
    totalTokens: add(a?.totalTokens, b?.totalTokens),
  };
}

function parseModelList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

/** Seconds form or HTTP-date form; anything else is `undefined`. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header || header.trim() === '') return undefined;
  const n = Number(header);
  if (Number.isFinite(n)) return n >= 0 ? n : undefined;
  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** Strips a surrounding markdown code fence, then `JSON.parse`s. */
function parseJsonContent(
  content: string,
): { ok: true; value: unknown } | { ok: false } {
  let text = content.trim();
  const fence = /^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?\s*```$/.exec(text);
  if (fence) text = fence[1].trim();
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
