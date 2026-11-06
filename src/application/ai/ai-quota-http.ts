import {
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AiQuotaExceededError,
  AiQuotaUnavailableError,
} from '../../domain/ai/ai-quota.errors';

/** A daily AI cap is spent; the caller should wait. Maps to 429. */
export class AiQuotaThrottledException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message,
        error: 'Too Many Requests',
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
    return new AiQuotaThrottledException(err.message, err.retryAfterSeconds);
  }
  if (err instanceof AiQuotaUnavailableError) {
    return new ServiceUnavailableException(err.message);
  }
  return null;
}
