import { createHash } from 'node:crypto';
import request from 'supertest';
import { io as ioClient, Socket } from 'socket.io-client';
import { describeWithDocker } from './utils/pg-testcontainer';
import {
  bootIdentityApp,
  CapturingMailbox,
  IdentityApp,
  loginToken,
  PASSWORD,
  settle,
  waitUntil,
} from './utils/identity-app';
import { registerUser } from './utils/register-user';

describeWithDocker()('Email identity (e2e)', () => {
  let ctx: IdentityApp;
  let counter = 0;
  const sockets: Socket[] = [];

  const http = () => request(ctx.app.getHttpServer());
  const sha256 = (value: string) =>
    createHash('sha256').update(value).digest('hex');

  function newEmail(prefix = 'user'): string {
    counter += 1;
    return `${prefix}-${counter}@example.com`;
  }

  async function register(email: string): Promise<void> {
    await registerUser(ctx.app, {
      email,
      password: PASSWORD,
      display_name: 'Test User',
    });
  }

  /** Registers, waits for the verification mail and returns its raw token. */
  async function registerWithMail(email: string): Promise<string> {
    await register(email);
    await waitUntil(() => ctx.mailbox.to(email, 'Verify').length > 0);
    return CapturingMailbox.tokenOf(ctx.mailbox.to(email, 'Verify')[0]);
  }

  async function requestResetToken(email: string): Promise<string> {
    const before = ctx.mailbox.to(email, 'Reset').length;
    await http().post('/auth/forgot-password').send({ email }).expect(202);
    await waitUntil(() => ctx.mailbox.to(email, 'Reset').length > before);
    return CapturingMailbox.tokenOf(ctx.mailbox.to(email, 'Reset')[before]);
  }

  const me = (token: string) =>
    http().get('/users/me').set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ctx = await bootIdentityApp();
  }, 240_000);

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.removeAllListeners();
      socket.disconnect();
    }
  });

  afterAll(async () => {
    await ctx?.stop();
  });

  describe('unique, case-insensitive email', () => {
    it('treats A@x.com and a@x.com as the same account, and login works in any case', async () => {
      await register('Case.Test@Example.com');
      await register('case.test@example.com');

      const rows = await ctx.query(
        `SELECT email FROM users WHERE lower(email) = 'case.test@example.com'`,
      );
      expect(rows).toEqual([{ email: 'case.test@example.com' }]);

      for (const variant of [
        'case.test@example.com',
        'CASE.TEST@EXAMPLE.COM',
      ]) {
        await http()
          .post('/auth/login')
          .send({ email: variant, password: PASSWORD })
          .expect(200);
      }
    });

    it('stores only one account when the same new address registers concurrently', async () => {
      const email = newEmail('race');
      const payload = {
        email,
        password: PASSWORD,
        display_name: 'Racer',
      };

      const results = await Promise.all([
        http().post('/auth/register').send(payload),
        http().post('/auth/register').send(payload),
        http().post('/auth/register').send(payload),
      ]);

      expect(results.map((r) => r.status)).toEqual([202, 202, 202]);
      const rows = await ctx.query(`SELECT id FROM users WHERE email = $1`, [
        email,
      ]);
      expect(rows).toHaveLength(1);
    });

    it('rejects a mixed-case email at the database level', async () => {
      await expect(
        ctx.query(
          `INSERT INTO users (email, password_hash, display_name) VALUES ('Mixed@Example.com', 'h', 'x')`,
        ),
      ).rejects.toThrow(/CHK_users_email_lowercase/);
    });
  });

  describe('uniform responses', () => {
    it('register answers a new and an existing address identically, and leaves the existing account alone', async () => {
      const existing = newEmail('existing');
      await register(existing);

      const payload = { password: 'different-password-123', display_name: 'X' };
      const fresh = await http()
        .post('/auth/register')
        .send({ ...payload, email: newEmail('fresh') });
      const dup = await http()
        .post('/auth/register')
        .send({ ...payload, email: existing });

      expect(dup.status).toBe(202);
      expect(dup.status).toBe(fresh.status);
      expect(dup.body).toEqual(fresh.body);
      expect(Object.keys(dup.body)).toEqual(['message']);

      await waitUntil(
        () => ctx.mailbox.to(existing, 'already have a').length > 0,
      );
      expect(ctx.mailbox.to(existing, 'already have a')[0].text).toMatch(
        /https:\/\/app\.test\/reset-password#token=\S+/,
      );
      // Original password still works; the attempted one does not.
      await loginToken(ctx.app, existing);
      await http()
        .post('/auth/login')
        .send({ email: existing, password: payload.password })
        .expect(401);
    });

    it('forgot-password answers a known and an unknown address identically', async () => {
      const known = newEmail('known');
      await register(known);

      const a = await http()
        .post('/auth/forgot-password')
        .send({ email: known });
      const b = await http()
        .post('/auth/forgot-password')
        .send({ email: 'nobody-here@example.com' });

      expect(a.status).toBe(202);
      expect(b.status).toBe(a.status);
      expect(b.body).toEqual(a.body);

      await waitUntil(() => ctx.mailbox.to(known, 'Reset').length > 0);
      await settle();
      expect(ctx.mailbox.to('nobody-here@example.com')).toHaveLength(0);
    });

    it('rejects malformed input with 400 on the new endpoints', async () => {
      await http()
        .post('/auth/forgot-password')
        .send({ email: 'nope' })
        .expect(400);
      await http()
        .post('/auth/reset-password')
        .send({ token: 'abc', new_password: 'short' })
        .expect(400);
      await http().post('/auth/verify-email').send({}).expect(400);
    });
  });

  describe('password reset', () => {
    it('resets end to end: old password and old JWT stop working, the new password works', async () => {
      const email = newEmail('reset');
      const verifyToken = await registerWithMail(email);
      const oldJwt = await loginToken(ctx.app, email);
      await me(oldJwt).expect(200);

      const resetToken = await requestResetToken(email);
      expect(ctx.mailbox.to(email, 'Reset')[0].text).toContain(
        `https://app.test/reset-password#token=${resetToken}`,
      );

      await http()
        .post('/auth/reset-password')
        .send({ token: resetToken, new_password: 'a-brand-new-password' })
        .expect(204);

      await http()
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
      const newJwt = await loginToken(ctx.app, email, 'a-brand-new-password');
      await me(oldJwt).expect(401);
      const profile = await me(newJwt).expect(200);
      // Completing a reset proves control of the mailbox.
      expect(profile.body.email_verified).toBe(true);

      // The user's other unused tokens were invalidated.
      await http()
        .post('/auth/verify-email')
        .send({ token: verifyToken })
        .expect(400);

      // Reuse is rejected.
      await http()
        .post('/auth/reset-password')
        .send({ token: resetToken, new_password: 'yet-another-password' })
        .expect(400);
    });

    it('stores only a hash of the token', async () => {
      const email = newEmail('hash');
      await register(email);
      const resetToken = await requestResetToken(email);
      const verifyToken = CapturingMailbox.tokenOf(
        ctx.mailbox.to(email, 'Verify')[0],
      );

      const rows = await ctx.query(
        `SELECT t.token_hash FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE u.email = $1`,
        [email],
      );
      const hashes = rows.map((r) => r.token_hash as string);
      expect(hashes).toEqual(
        expect.arrayContaining([sha256(resetToken), sha256(verifyToken)]),
      );
      expect(hashes).not.toContain(resetToken);
      expect(hashes).not.toContain(verifyToken);
      const dump = JSON.stringify(await ctx.query(`SELECT * FROM auth_tokens`));
      expect(dump).not.toContain(resetToken);
      expect(dump).not.toContain(verifyToken);
    });

    it('rejects expired and tampered tokens with the same 400', async () => {
      const email = newEmail('expired');
      await register(email);
      const resetToken = await requestResetToken(email);

      await http()
        .post('/auth/reset-password')
        .send({ token: `${resetToken}x`, new_password: 'a-brand-new-password' })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toBe('Invalid or expired token');
        });

      await ctx.query(
        `UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`,
        [sha256(resetToken)],
      );
      const expired = await http()
        .post('/auth/reset-password')
        .send({ token: resetToken, new_password: 'a-brand-new-password' })
        .expect(400);
      expect(expired.body.message).toBe('Invalid or expired token');
      await loginToken(ctx.app, email);
    });

    it('does not accept a verification token as a reset token, or the reverse', async () => {
      const email = newEmail('crosstype');
      const verifyToken = await registerWithMail(email);
      const resetToken = await requestResetToken(email);

      await http()
        .post('/auth/reset-password')
        .send({ token: verifyToken, new_password: 'a-brand-new-password' })
        .expect(400);
      await http()
        .post('/auth/verify-email')
        .send({ token: resetToken })
        .expect(400);
    });

    it('sends nothing for a second request inside the issue limit', async () => {
      const email = newEmail('limit');
      await register(email);
      await requestResetToken(email);

      await http().post('/auth/forgot-password').send({ email }).expect(202);
      await http().post('/auth/forgot-password').send({ email }).expect(202);
      await settle();

      expect(ctx.mailbox.to(email, 'Reset')).toHaveLength(1);
      const rows = await ctx.query(
        `SELECT count(*)::int AS n FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE u.email = $1 AND t.type = 'password_reset'`,
        [email],
      );
      expect(rows[0].n).toBe(1);

      // After the window passes, a new request is served again.
      await ctx.query(
        `UPDATE auth_tokens SET created_at = now() - interval '6 minutes' WHERE type = 'password_reset' AND user_id = (SELECT id FROM users WHERE email = $1)`,
        [email],
      );
      await requestResetToken(email);
      expect(ctx.mailbox.to(email, 'Reset')).toHaveLength(2);
    });

    it('does not spend the token when the password update fails', async () => {
      const email = newEmail('atomic');
      await register(email);
      const resetToken = await requestResetToken(email);
      await ctx.query(
        `CREATE OR REPLACE FUNCTION test_block_user_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'blocked'; END; $$ LANGUAGE plpgsql`,
      );
      await ctx.query(
        `CREATE TRIGGER test_block_user_update BEFORE UPDATE OF password_hash ON users FOR EACH ROW WHEN (NEW.email = '${email}') EXECUTE FUNCTION test_block_user_update()`,
      );

      const failed = await http()
        .post('/auth/reset-password')
        .send({ token: resetToken, new_password: 'a-brand-new-password' });
      expect(failed.status).toBe(500);

      await ctx.query(`DROP TRIGGER test_block_user_update ON users`);
      await http()
        .post('/auth/reset-password')
        .send({ token: resetToken, new_password: 'a-brand-new-password' })
        .expect(204);
    });

    it('treats a disabled account as unknown: no mail, and an earlier token cannot reset', async () => {
      const email = newEmail('disabled');
      await register(email);
      const resetToken = await requestResetToken(email);
      await ctx.query(`UPDATE users SET disabled_at = now() WHERE email = $1`, [
        email,
      ]);
      await ctx.query(
        `UPDATE auth_tokens SET created_at = now() - interval '6 minutes' WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
        [email],
      );

      await http().post('/auth/forgot-password').send({ email }).expect(202);
      await settle();
      expect(ctx.mailbox.to(email, 'Reset')).toHaveLength(1);

      await http()
        .post('/auth/reset-password')
        .send({ token: resetToken, new_password: 'a-brand-new-password' })
        .expect(400);
      const rows = await ctx.query(
        `SELECT token_version FROM users WHERE email = $1`,
        [email],
      );
      expect(rows[0].token_version).toBe(0);
    });

    it('drops a connected WebSocket once the password is reset', async () => {
      const email = newEmail('socket');
      await register(email);
      const jwt = await loginToken(ctx.app, email);

      const socket = ioClient(ctx.baseUrl, {
        auth: { token: jwt },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no ready')), 10_000);
        socket.once('ready', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      const disconnected = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('socket was not dropped')),
          10_000,
        );
        socket.once('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      const resetToken = await requestResetToken(email);
      await http()
        .post('/auth/reset-password')
        .send({ token: resetToken, new_password: 'a-brand-new-password' })
        .expect(204);

      await disconnected;
      expect(socket.connected).toBe(false);

      // Reconnecting with the pre-reset token is refused too.
      const stale = ioClient(ctx.baseUrl, {
        auth: { token: jwt },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      sockets.push(stale);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('not dropped')),
          10_000,
        );
        stale.once('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }, 40_000);
  });

  describe('change password', () => {
    it('rejects a wrong current password with 400 and changes nothing', async () => {
      const email = newEmail('chg-bad');
      await register(email);
      const jwt = await loginToken(ctx.app, email);

      await http()
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          current_password: 'wrong-password',
          new_password: 'new-password-123',
        })
        .expect(400);

      await me(jwt).expect(200);
      await loginToken(ctx.app, email);
    });

    it('invalidates a reset token requested earlier', async () => {
      const email = newEmail('chg-tokens');
      await register(email);
      const jwt = await loginToken(ctx.app, email);
      const resetToken = await requestResetToken(email);

      await http()
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${jwt}`)
        .send({ current_password: PASSWORD, new_password: 'new-password-123' })
        .expect(200);

      await http()
        .post('/auth/reset-password')
        .send({ token: resetToken, new_password: 'another-password-123' })
        .expect(400);
    });

    it('completes when a reset and a password change run at the same time', async () => {
      const email = newEmail('concurrent');
      await register(email);
      const jwt = await loginToken(ctx.app, email);
      const resetToken = await requestResetToken(email);

      const [reset, change] = await Promise.all([
        http()
          .post('/auth/reset-password')
          .send({ token: resetToken, new_password: 'reset-password-123' }),
        http()
          .post('/auth/change-password')
          .set('Authorization', `Bearer ${jwt}`)
          .send({
            current_password: PASSWORD,
            new_password: 'change-password-123',
          }),
      ]);

      // Neither request may deadlock or error; each is either applied or
      // rejected as a client error, and the token ends up spent.
      expect([204, 400]).toContain(reset.status);
      expect([200, 400, 401]).toContain(change.status);
      await http()
        .post('/auth/reset-password')
        .send({ token: resetToken, new_password: 'third-password-123' })
        .expect(400);
    });

    it('requires authentication', async () => {
      await http()
        .post('/auth/change-password')
        .send({ current_password: PASSWORD, new_password: 'new-password-123' })
        .expect(401);
    });

    it('returns a working token on success and rejects the old one', async () => {
      const email = newEmail('chg-ok');
      await register(email);
      const oldJwt = await loginToken(ctx.app, email);

      const res = await http()
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${oldJwt}`)
        .send({ current_password: PASSWORD, new_password: 'new-password-123' })
        .expect(200);

      const newJwt = res.body.accessToken as string;
      expect(newJwt).toEqual(expect.any(String));
      await me(newJwt).expect(200);
      await me(oldJwt).expect(401);
      await loginToken(ctx.app, email, 'new-password-123');
      await http()
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
    });
  });

  describe('email verification', () => {
    it('verifies with the emailed token, once', async () => {
      const email = newEmail('verify');
      const token = await registerWithMail(email);
      expect(ctx.mailbox.to(email, 'Verify')[0].text).toContain(
        `https://app.test/verify-email#token=${token}`,
      );
      const jwt = await loginToken(ctx.app, email);
      expect((await me(jwt).expect(200)).body.email_verified).toBe(false);

      await http().post('/auth/verify-email').send({ token }).expect(204);

      expect((await me(jwt).expect(200)).body.email_verified).toBe(true);
      await http()
        .post('/auth/verify-email')
        .send({ token })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toBe('Invalid or expired token');
        });
    });

    it('rejects an expired verification token', async () => {
      const email = newEmail('verify-exp');
      const token = await registerWithMail(email);
      await ctx.query(
        `UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`,
        [sha256(token)],
      );

      await http().post('/auth/verify-email').send({ token }).expect(400);
    });

    it('answers a disabled account the uniform 400 and keeps the token unspent', async () => {
      const email = newEmail('verify-disabled');
      const token = await registerWithMail(email);
      await ctx.query(`UPDATE users SET disabled_at = now() WHERE email = $1`, [
        email,
      ]);

      await http().post('/auth/verify-email').send({ token }).expect(400);

      await ctx.query(`UPDATE users SET disabled_at = NULL WHERE email = $1`, [
        email,
      ]);
      await http().post('/auth/verify-email').send({ token }).expect(204);
    });

    it('resend-verification is a no-op for a verified account', async () => {
      const email = newEmail('resend-ok');
      const token = await registerWithMail(email);
      await http().post('/auth/verify-email').send({ token }).expect(204);
      const jwt = await loginToken(ctx.app, email);

      await http()
        .post('/auth/resend-verification')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(202);
      await settle();

      expect(ctx.mailbox.to(email, 'Verify')).toHaveLength(1);
    });

    it('resend-verification always answers 202 but sends once per rate-limit window', async () => {
      const email = newEmail('resend');
      await registerWithMail(email);
      const jwt = await loginToken(ctx.app, email);

      await http()
        .post('/auth/resend-verification')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(202);
      await settle();
      expect(ctx.mailbox.to(email, 'Verify')).toHaveLength(1);

      await ctx.query(
        `UPDATE auth_tokens SET created_at = now() - interval '6 minutes' WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
        [email],
      );
      await http()
        .post('/auth/resend-verification')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(202);
      await waitUntil(() => ctx.mailbox.to(email, 'Verify').length === 2);
    });

    it('resend-verification requires authentication', async () => {
      await http().post('/auth/resend-verification').expect(401);
    });
  });

  describe('verification flag off', () => {
    it('lets an unverified user use gated routes', async () => {
      const email = newEmail('flag-off');
      await register(email);
      const jwt = await loginToken(ctx.app, email);

      await http()
        .get('/connectors')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(200);
    });
  });
});
