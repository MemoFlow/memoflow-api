import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';

/**
 * Registers a user through the public endpoint. Registration answers 202 with
 * a uniform body (no user data), so callers that need the new user's id read
 * it from `/users/me` after logging in.
 */
export async function registerUser(
  app: INestApplication<App>,
  payload: { email: string; password: string; display_name: string },
): Promise<void> {
  await request(app.getHttpServer())
    .post('/auth/register')
    .send(payload)
    .expect(202);
}
