import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = exception.name;
      } else {
        const asRecord = body as Record<string, unknown>;
        message = (asRecord.message as string | string[]) ?? exception.message;
        error = (asRecord.error as string) ?? exception.name;
      }
    } else {
      // Unexpected error: log the details, never leak them to the client.
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Only unexpected 500s are reported to Sentry — 4xx HttpExceptions
      // (the `if` branch above) are expected control flow, not incidents.
      // Sentry.captureException is a module-level singleton, so this works
      // fine even though the filter is constructed with `new`, not DI.
      Sentry.captureException(exception);
    }

    const payload: ErrorBody = {
      statusCode,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(statusCode).json(payload);
  }
}
