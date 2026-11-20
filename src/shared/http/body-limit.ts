import { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Explicit JSON body ceiling. Express' implicit default is 100 kb, which
 * would silently clip the largest legitimate payloads (section content up to
 * 100_000 characters, multibyte); anything bigger is rejected with 413.
 */
export const JSON_BODY_LIMIT = '1mb';

export function applyBodyLimits(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });
}
