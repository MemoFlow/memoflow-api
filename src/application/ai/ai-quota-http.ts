import {
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AI_QUOTA_EXCEEDED_CODE,
  AiQuotaExceededError,
  AiQuotaUnavailableError,
} from '../../domain/ai/ai-quota.errors';

/** A daily AI cap is spent; the caller should wait. Maps to 429 with `error`
 * `AI_QUOTA_EXCEEDED` (user cap) or `AI_GLOBAL_QUOTA_EXCEEDED` (global cap). */
export class AiQuotaThrottledException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
    code: string = AI_QUOTA_EXCEEDED_CODE,
  ) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message,
        error: code,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * The HTTP error for a quota failure (429 with a retry hint, or 503 when the
 * counters are unreachable), or `null` for any other error. Messages are the
 * domain errors' fixed ones.
 */
export function quotaHttpException(err: unknown): HttpException | null {
  if (err instanceof AiQuotaExceededError) {
    return new AiQuotaThrottledException(
      err.message,
      err.retryAfterSeconds,
      err.code,
    );
  }
  if (err instanceof AiQuotaUnavailableError) {
    return new ServiceUnavailableException(err.message);
  }
  return null;
}
