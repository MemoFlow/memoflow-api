import { HttpException, HttpStatus } from '@nestjs/common';

/** Too many login attempts for one account; the caller should wait. */
export class LoginThrottledException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many login attempts. Try again later.',
        error: 'Too Many Requests',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
