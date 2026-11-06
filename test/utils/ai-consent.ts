import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { AI_NOTICE_VERSION } from '../../src/domain/ai/ai-consent';

/**
 * Accepts the current AI notice for the token's user through the public
 * endpoint, so e2e suites that call AI routes (suggestions, planning jobs)
 * run as a consenting user.
 */
export async function acceptAiConsent(
  app: INestApplication<App>,
  token: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post('/users/me/ai-consent')
    .set('Authorization', `Bearer ${token}`)
    .send({ version: AI_NOTICE_VERSION })
    .expect(200);
}
