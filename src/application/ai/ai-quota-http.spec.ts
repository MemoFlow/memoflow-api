import { ServiceUnavailableException } from '@nestjs/common';
import {
  AiQuotaExceededError,
  AiQuotaUnavailableError,
} from '../../domain/ai/ai-quota.errors';
import { AiQuotaThrottledException, quotaHttpException } from './ai-quota-http';

describe('quotaHttpException', () => {
  it('maps the user cap to 429 AI_QUOTA_EXCEEDED with the explicit message', () => {
    const ex = quotaHttpException(new AiQuotaExceededError('user', 10, 5400));

    expect(ex).toBeInstanceOf(AiQuotaThrottledException);
    expect(ex?.getStatus()).toBe(429);
    expect((ex as AiQuotaThrottledException).retryAfterSeconds).toBe(5400);
    expect(ex?.getResponse()).toEqual({
      statusCode: 429,
      message:
        "You've used all 10 AI requests for today. Your quota resets at 00:00 UTC (in 1 h 30 min).",
      error: 'AI_QUOTA_EXCEEDED',
    });
  });

  it('maps the global cap to AI_GLOBAL_QUOTA_EXCEEDED', () => {
    const ex = quotaHttpException(new AiQuotaExceededError('global', 40, 600));

    expect(ex?.getResponse()).toEqual({
      statusCode: 429,
      message:
        "MemoFlow's AI capacity for today has been reached. It resets at 00:00 UTC (in 10 min).",
      error: 'AI_GLOBAL_QUOTA_EXCEEDED',
    });
  });

  it('maps unreachable counters to 503 and ignores other errors', () => {
    expect(quotaHttpException(new AiQuotaUnavailableError())).toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(quotaHttpException(new Error('x'))).toBeNull();
  });
});
