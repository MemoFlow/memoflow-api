import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { HttpExceptionFilter } from './http-exception.filter';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

function createHost(url = '/some/path'): {
  host: ArgumentsHost;
  json: jest.Mock;
  status: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { url };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, json, status };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new HttpExceptionFilter();
  });

  it('reports an unexpected (non-HttpException) error to Sentry exactly once', () => {
    const { host, json, status } = createHost();
    const error = new Error('boom');

    filter.catch(error, host);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0] as {
      statusCode: number;
      message: string | string[];
      error: string;
      path: string;
      timestamp: string;
    };
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(body.error).toBe('Internal Server Error');
    expect(body.path).toBe('/some/path');
    expect(typeof body.timestamp).toBe('string');
  });

  it('does NOT report a thrown HttpException (e.g. NotFoundException) to Sentry', () => {
    const { host, json, status } = createHost('/missing');
    const exception = new NotFoundException('nope');

    filter.catch(exception, host);

    expect(Sentry.captureException).not.toHaveBeenCalled();

    expect(status).toHaveBeenCalledWith(404);
    const body = json.mock.calls[0][0] as {
      statusCode: number;
      message: string | string[];
      error: string;
      path: string;
      timestamp: string;
    };
    expect(body.statusCode).toBe(404);
    expect(body.message).toBe('nope');
    expect(body.error).toBe('Not Found');
    expect(body.path).toBe('/missing');
    expect(typeof body.timestamp).toBe('string');
  });

  it('does NOT report a thrown BadRequestException to Sentry', () => {
    const { host, json, status } = createHost('/bad');
    const exception = new BadRequestException('invalid');

    filter.catch(exception, host);

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0] as { statusCode: number };
    expect(body.statusCode).toBe(400);
  });
});
