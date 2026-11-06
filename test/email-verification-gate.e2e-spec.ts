import request from 'supertest';
import { describeWithDocker } from './utils/pg-testcontainer';
import {
  bootIdentityApp,
  IdentityApp,
  loginToken,
  PASSWORD,
} from './utils/identity-app';
import { registerUser } from './utils/register-user';

// A separate file (and so a separate module registry) because the flag is
// read from the environment when AppModule is first imported.
describeWithDocker()('Email verification gate (e2e)', () => {
  let ctx: IdentityApp;
  let unverified: string;
  let verified: string;

  const http = () => request(ctx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const SECTION = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    ctx = await bootIdentityApp({ EMAIL_VERIFICATION_REQUIRED: 'true' });
    for (const email of [
      'gate-unverified@example.com',
      'gate-ok@example.com',
    ]) {
      await registerUser(ctx.app, {
        email,
        password: PASSWORD,
        display_name: 'Gate',
      });
    }
    await ctx.query(
      `UPDATE users SET email_verified_at = now() WHERE email = 'gate-ok@example.com'`,
    );
    unverified = await loginToken(ctx.app, 'gate-unverified@example.com');
    verified = await loginToken(ctx.app, 'gate-ok@example.com');
  }, 240_000);

  afterAll(async () => {
    await ctx?.stop();
  });

  it('shows the verification state on /users/me', async () => {
    const a = await http().get('/users/me').set(as(unverified)).expect(200);
    const b = await http().get('/users/me').set(as(verified)).expect(200);
    expect(a.body.email_verified).toBe(false);
    expect(b.body.email_verified).toBe(true);
  });

  it.each([
    ['GET', '/connectors'],
    ['POST', '/connectors/trello/connect'],
    ['POST', '/planning-jobs'],
    ['GET', `/planning-jobs/${SECTION}`],
    ['POST', `/sections/${SECTION}/suggestions`],
    ['GET', `/sections/${SECTION}/suggestions`],
    ['PATCH', `/suggestions/${SECTION}`],
  ])(
    'answers 403 "Email not verified" to an unverified user on %s %s',
    async (method, path) => {
      const res = await http()
        [method.toLowerCase() as 'get' | 'post' | 'patch'](path)
        .set(as(unverified))
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Email not verified');
    },
  );

  it('lets an unverified user keep using documents, sections, versions and templates', async () => {
    const doc = await http()
      .post('/documents')
      .set(as(unverified))
      .send({ title: 'Mine', docType: 'blog' })
      .expect(201);
    await http().get('/documents').set(as(unverified)).expect(200);
    await http()
      .get(`/documents/${doc.body.id}/sections`)
      .set(as(unverified))
      .expect(200);
    await http()
      .get(`/documents/${doc.body.id}/versions`)
      .set(as(unverified))
      .expect(200);
    await http().get('/templates').set(as(unverified)).expect(200);
  });

  it('lets a verified user through the gate', async () => {
    await http().get('/connectors').set(as(verified)).expect(200);
    const res = await http()
      .get(`/sections/${SECTION}/suggestions`)
      .set(as(verified));
    expect(res.status).not.toBe(403);
  });

  it('leaves the provider webhook unaffected by the gate', async () => {
    const res = await http().post('/connectors/webhook').send({});
    expect(res.status).not.toBe(403);
  });

  it('still answers 401 (not 403) when no token is presented', async () => {
    await http().get('/connectors').expect(401);
  });
});
