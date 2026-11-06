import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';
import { promoteToAdmin } from './utils/promote-admin';

// Booting AppModule requires a live PostgreSQL (Testcontainers, so Docker).
// Migrations run against the fresh container first, so the CreateLeadScoring
// migration is what creates the tables these routes read. The Composio
// gateway is faked: this suite never calls Composio.

const PASSWORD = 'correct-horse-battery-staple';
const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

type Counts = Record<string, number>;

interface LeadBody {
  user_id: string;
  score: number;
  tier: string;
  suggested_action: string;
  score_computed_at: string | null;
  marketing_opt_in: boolean;
  breakdown: { rule: string; points: number }[];
  active_connectors: string[];
  signals: { type: string; occurrences: number }[];
  onboarding: { completed: boolean };
  [key: string]: unknown;
}

interface ListBody {
  items: LeadBody[];
  total: number;
  page: number;
  limit: number;
}

interface StatsBody {
  generated_at: string;
  total_leads: number;
  tiers: Counts;
  suggested_actions: Counts;
  onboarding: Counts;
  marketing_opt_in: number;
  connected_tool: number;
  signals: Counts;
  distributions: Record<string, Counts>;
}

interface TestUser {
  id: string;
  email: string;
  token: string;
}

/** UTC date `days` from today, as YYYY-MM-DD. */
function dateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function answers(overrides: Record<string, unknown> = {}) {
  return {
    persona: 'apprentice',
    deliverable_type: 'apprenticeship_report',
    due_date: dateIn(30),
    academic_level: 'm2',
    school_name: 'ESGI',
    work_tools: ['trello', 'email'],
    blockers: ['finding_past_work', 'lack_of_time'],
    acquisition_channel: 'friend',
    marketing_opt_in: true,
    ...overrides,
  };
}

describeWithDocker()('Leads (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let dataSource: DataSource;
  let admin: TestUser;
  let counter = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

  async function registerUser(
    opts: { admin?: boolean } = {},
  ): Promise<TestUser> {
    counter += 1;
    const email = `leads-${counter}@example.com`;
    const reg = await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, display_name: `Lead ${counter}` })
      .expect(201);
    if (opts.admin) await promoteToAdmin(pg.env, email);
    const login = await http()
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      id: reg.body.id as string,
      email,
      token: login.body.accessToken as string,
    };
  }

  const submit = (u: TestUser, body: object = answers()) =>
    http().put('/onboarding/me').set(auth(u)).send(body);

  const detail = async (id: string): Promise<LeadBody> =>
    (await http().get(`/leads/${id}`).set(auth(admin)).expect(200))
      .body as LeadBody;

  const stats = async (): Promise<StatsBody> =>
    (await http().get('/leads/stats').set(auth(admin)).expect(200))
      .body as StatsBody;

  const list = async (query: string): Promise<ListBody> =>
    (await http().get(`/leads${query}`).set(auth(admin)).expect(200))
      .body as ListBody;

  async function waitFor<T>(
    read: () => Promise<T>,
    done: (v: T) => boolean,
  ): Promise<T> {
    const deadline = Date.now() + 5_000;
    let value = await read();
    while (!done(value) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      value = await read();
    }
    return value;
  }

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    Object.assign(process.env, pg.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars-long',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
      COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
      ANTHROPIC_API_KEY: '',
    });

    // Apply migrations before boot — synchronize stays false everywhere.
    const dataSourceModule =
      await import('./../src/infrastructure/persistence/typeorm.data-source');
    const migrationDs = dataSourceModule.default;
    migrationDs.setOptions({
      host: pg.env.POSTGRES_HOST,
      port: Number(pg.env.POSTGRES_PORT),
      username: pg.env.POSTGRES_USER,
      password: pg.env.POSTGRES_PASSWORD,
      database: pg.env.POSTGRES_DB,
    });
    await migrationDs.initialize();
    await migrationDs.runMigrations();
    await migrationDs.destroy();

    const { AppModule } = await import('./../src/app.module');
    const { CONNECTOR_GATEWAY } =
      await import('./../src/domain/connectors/connector-gateway.port');

    const fakeGateway = {
      initiateConnection: () => Promise.reject(new Error('not used')),
      getConnectionStatus: () => Promise.resolve('active'),
      verifyWebhook: () => Promise.reject(new Error('not used')),
      revoke: () => Promise.resolve(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CONNECTOR_GATEWAY)
      .useValue(fakeGateway)
      .compile();

    app = moduleFixture.createNestApplication();
    // Mirrors src/main.ts exactly (implicit conversion is what makes the
    // string-consent and boolean-filter cases meaningful).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
    admin = await registerUser({ admin: true });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.container.stop();
    await mongo?.server.stop();
  });

  describe('user onboarding flow', () => {
    it('requires a token', async () => {
      await http().get('/onboarding/me').expect(401);
      await http().put('/onboarding/me').send(answers()).expect(401);
      await http().post('/lead-signals').send({}).expect(401);
    });

    it('GET /onboarding/me before submit is 200 with nulls and completed=false', async () => {
      const user = await registerUser();
      const res = await http()
        .get('/onboarding/me')
        .set(auth(user))
        .expect(200);
      expect(res.body).toEqual({
        completed: false,
        persona: null,
        deliverable_type: null,
        due_date: null,
        academic_level: null,
        school_name: null,
        work_tools: null,
        blockers: null,
        acquisition_channel: null,
        marketing_opt_in: false,
        marketing_opt_in_at: null,
        submitted_at: null,
      });
    });

    it('consent before submit is 409', async () => {
      const user = await registerUser();
      await http()
        .put('/onboarding/me/consent')
        .set(auth(user))
        .send({ marketing_opt_in: true })
        .expect(409);
    });

    it('submit, resubmit, and consent follow the marketing_opt_in_at rule', async () => {
      const user = await registerUser();
      const first = await submit(user).expect(200);
      expect(first.body).toMatchObject({
        completed: true,
        persona: 'apprentice',
        school_name: 'ESGI',
        work_tools: ['trello', 'email'],
        marketing_opt_in: true,
      });
      const optInAt = first.body.marketing_opt_in_at as string;
      expect(optInAt).toEqual(expect.any(String));
      expect(first.body.submitted_at).toEqual(expect.any(String));

      // Same consent value: timestamp untouched, answers replaced.
      const again = await submit(
        user,
        answers({ persona: 'student', school_name: '   ' }),
      ).expect(200);
      expect(again.body.persona).toBe('student');
      expect(again.body.school_name).toBeNull();
      expect(again.body.marketing_opt_in_at).toBe(optInAt);

      // Withdrawal through the consent route changes the timestamp.
      const withdrawn = await http()
        .put('/onboarding/me/consent')
        .set(auth(user))
        .send({ marketing_opt_in: false })
        .expect(200);
      expect(withdrawn.body.marketing_opt_in).toBe(false);
      expect(withdrawn.body.marketing_opt_in_at).not.toBe(optInAt);
      const withdrawnAt = withdrawn.body.marketing_opt_in_at as string;

      const same = await http()
        .put('/onboarding/me/consent')
        .set(auth(user))
        .send({ marketing_opt_in: false })
        .expect(200);
      expect(same.body.marketing_opt_in_at).toBe(withdrawnAt);

      // A full submit with a changed value also moves it.
      const changed = await submit(user).expect(200);
      expect(changed.body.marketing_opt_in_at).not.toBe(withdrawnAt);

      const got = await http()
        .get('/onboarding/me')
        .set(auth(user))
        .expect(200);
      expect(got.body.completed).toBe(true);
    });

    it('user cannot see another user data', async () => {
      const a = await registerUser();
      const b = await registerUser();
      await submit(a).expect(200);
      const res = await http().get('/onboarding/me').set(auth(b)).expect(200);
      expect(res.body.completed).toBe(false);
    });

    it('user routes never expose score fields', async () => {
      const user = await registerUser();
      const bodies = [
        (await submit(user).expect(200)).body,
        (await http().get('/onboarding/me').set(auth(user)).expect(200)).body,
        (
          await http()
            .put('/onboarding/me/consent')
            .set(auth(user))
            .send({ marketing_opt_in: true })
            .expect(200)
        ).body,
      ];
      for (const body of bodies) {
        for (const key of [
          'score',
          'tier',
          'breakdown',
          'suggested_action',
          'score_computed_at',
        ]) {
          expect(body).not.toHaveProperty(key);
        }
      }
      const signal = await http()
        .post('/lead-signals')
        .set(auth(user))
        .send({ type: 'export_paywall_hit' })
        .expect(204);
      expect(signal.text).toBe('');
    });

    it.each([
      ['string "false" consent', { marketing_opt_in: 'false' }],
      ['string "true" consent', { marketing_opt_in: 'true' }],
      ['missing consent', { marketing_opt_in: undefined }],
      ['unknown persona', { persona: 'wizard' }],
      ['bad calendar date', { due_date: '2027-02-30' }],
      ['past due date', { due_date: '2020-01-01' }],
      ['empty blockers', { blockers: [] }],
      ['duplicate work_tools', { work_tools: ['trello', 'trello'] }],
      ['missing work_tools', { work_tools: undefined }],
      ['school_name too long', { school_name: 'x'.repeat(121) }],
    ])('submit rejects %s with 400', async (_name, override) => {
      const user = await registerUser();
      await submit(user, answers(override)).expect(400);
    });

    it('consent route rejects a string "false" with 400', async () => {
      const user = await registerUser();
      await submit(user).expect(200);
      await http()
        .put('/onboarding/me/consent')
        .set(auth(user))
        .send({ marketing_opt_in: 'false' })
        .expect(400);
    });

    it('accepts [] work_tools and null/omitted school_name', async () => {
      const user = await registerUser();
      const res = await submit(
        user,
        answers({ work_tools: [], school_name: null }),
      ).expect(200);
      expect(res.body.work_tools).toEqual([]);
      expect(res.body.school_name).toBeNull();
    });

    it('rejects an unknown signal type with 400', async () => {
      const user = await registerUser();
      await http()
        .post('/lead-signals')
        .set(auth(user))
        .send({ type: 'nope' })
        .expect(400);
    });

    it('a stored past due date still allows resubmit and consent withdrawal', async () => {
      const user = await registerUser();
      await submit(user).expect(200);
      await dataSource.query(
        `UPDATE onboarding_profiles SET due_date = (current_date - 10) WHERE user_id = $1`,
        [user.id],
      );
      const stored = (
        await http().get('/onboarding/me').set(auth(user)).expect(200)
      ).body.due_date as string;
      expect(stored < dateIn(0)).toBe(true);

      await submit(user, answers({ due_date: stored })).expect(200);
      await http()
        .put('/onboarding/me/consent')
        .set(auth(user))
        .send({ marketing_opt_in: false })
        .expect(200);
      // A different past date is still rejected.
      await submit(user, answers({ due_date: '2020-01-01' })).expect(400);
      // Past due date scores no due-date points.
      const d = await detail(user.id);
      expect(d.breakdown.map((e: { rule: string }) => e.rule)).not.toContain(
        'due_within_3_months',
      );
    });
  });

  describe('scoring', () => {
    it('apprentice + due soon + trello is 7 warm; paywall makes it 10 hot; repeat stays 10', async () => {
      const user = await registerUser();
      await submit(user).expect(200);

      let d = await detail(user.id);
      expect(d).toMatchObject({
        score: 7,
        tier: 'warm',
        suggested_action: 'scheduled_emails',
        onboarding_completed: true,
      });
      expect(d.breakdown).toEqual(
        expect.arrayContaining([
          { rule: 'due_within_3_months', points: 3 },
          { rule: 'persona_apprentice', points: 2 },
          { rule: 'cited_trello', points: 2 },
        ]),
      );
      expect(d.breakdown).toHaveLength(3);
      expect(d.score_computed_at).toEqual(expect.any(String));

      const signal = () =>
        http()
          .post('/lead-signals')
          .set(auth(user))
          .send({ type: 'export_paywall_hit' })
          .expect(204);
      await signal();
      d = await detail(user.id);
      expect(d).toMatchObject({ score: 10, tier: 'hot' });
      expect(d.suggested_action).toBe('interview_and_pro_offer');
      expect(d.signals).toHaveLength(1);

      await signal();
      d = await detail(user.id);
      expect(d.score).toBe(10);
      expect(d.signals).toHaveLength(1);
      expect(d.signals[0]).toMatchObject({
        type: 'export_paywall_hit',
        occurrences: 2,
      });
    });

    it('suggested_action follows a consent change without recalculation', async () => {
      const user = await registerUser();
      await submit(user).expect(200);
      const before = await detail(user.id);
      await http()
        .put('/onboarding/me/consent')
        .set(auth(user))
        .send({ marketing_opt_in: false })
        .expect(200);
      const after = await detail(user.id);
      expect(after.suggested_action).toBe('no_outreach');
      expect(after.marketing_opt_in).toBe(false);
      expect(after.score).toBe(before.score);
      expect(after.score_computed_at).toBe(before.score_computed_at);
    });

    it('revoking an active connector lowers the score', async () => {
      const user = await registerUser();
      const [row] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO connector_connections (user_id, provider, composio_account_id, status, connected_at)
         VALUES ($1, 'trello', 'ca_leads_e2e', 'active', now()) RETURNING id`,
        [user.id],
      );
      // Submit triggers a recalculation that sees the active connector.
      await submit(user).expect(200);
      let d = await detail(user.id);
      expect(d.score).toBe(10);
      expect(d.active_connectors).toEqual(['trello']);
      expect(d.breakdown).toEqual(
        expect.arrayContaining([{ rule: 'connected_tool', points: 3 }]),
      );

      await http().delete(`/connectors/${row.id}`).set(auth(user)).expect(204);

      d = await waitFor(
        () => detail(user.id),
        (v) => v.score === 7,
      );
      expect(d.score).toBe(7);
      expect(d.tier).toBe('warm');
      expect(d.active_connectors).toEqual([]);
    });

    it('a never-scored user reads as 0 / cold / no breakdown', async () => {
      const user = await registerUser();
      const d = await detail(user.id);
      expect(d).toMatchObject({
        user_id: user.id,
        email: user.email,
        score: 0,
        tier: 'cold',
        suggested_action: 'no_outreach',
        score_computed_at: null,
        onboarding_completed: false,
        persona: null,
        due_date: null,
        marketing_opt_in: false,
        breakdown: [],
        active_connectors: [],
        signals: [],
      });
      expect(d.onboarding).toMatchObject({
        completed: false,
        persona: null,
        marketing_opt_in: false,
      });
      expect(d.registered_at).toEqual(expect.any(String));
    });

    it('a behaviour signal scores a user who never submitted onboarding', async () => {
      const user = await registerUser();
      await http()
        .post('/lead-signals')
        .set(auth(user))
        .send({ type: 'export_paywall_hit' })
        .expect(204);
      const d = await detail(user.id);
      expect(d).toMatchObject({ score: 3, tier: 'cold' });
      expect(d.onboarding.completed).toBe(false);
    });

    it('signals from admins are accepted and ignored', async () => {
      await http()
        .post('/lead-signals')
        .set(auth(admin))
        .send({ type: 'export_paywall_hit' })
        .expect(204);
      await http().get(`/leads/${admin.id}`).set(auth(admin)).expect(404);
    });
  });

  describe('admin routes', () => {
    it('non-admins get 403 on every /leads route; no token gets 401', async () => {
      const user = await registerUser();
      await http().get('/leads').set(auth(user)).expect(403);
      await http().get('/leads/stats').set(auth(user)).expect(403);
      await http().get(`/leads/${user.id}`).set(auth(user)).expect(403);
      await http().get('/leads').expect(401);
      await http().get('/leads/stats').expect(401);
      await http().get(`/leads/${user.id}`).expect(401);
    });

    it('GET /leads/stats is not captured by :id', async () => {
      const res = await http().get('/leads/stats').set(auth(admin)).expect(200);
      expect(res.body).toHaveProperty('total_leads');
    });

    it('GET /leads/:id rejects non-uuid with 400 and unknown/admin/disabled with 404', async () => {
      await http().get('/leads/not-a-uuid').set(auth(admin)).expect(400);
      await http().get(`/leads/${ZERO_UUID}`).set(auth(admin)).expect(404);
      await http().get(`/leads/${admin.id}`).set(auth(admin)).expect(404);

      const disabled = await registerUser();
      await dataSource.query(
        `UPDATE users SET disabled_at = now() WHERE id = $1`,
        [disabled.id],
      );
      await http().get(`/leads/${disabled.id}`).set(auth(admin)).expect(404);
    });

    it('list filters, clamping and boolean parsing', async () => {
      const optedIn = await registerUser();
      const optedOut = await registerUser();
      await submit(optedIn).expect(200);
      await submit(optedOut, answers({ marketing_opt_in: false })).expect(200);

      const ids = (body: ListBody) => body.items.map((i) => i.user_id);

      const off = await list('?marketing_opt_in=false&limit=100');
      expect(off.items.length).toBeGreaterThan(0);
      expect(off.items.every((i) => i.marketing_opt_in === false)).toBe(true);
      expect(ids(off)).toContain(optedOut.id);
      expect(ids(off)).not.toContain(optedIn.id);

      const on = await list('?marketing_opt_in=true&limit=100');
      expect(ids(on)).toContain(optedIn.id);
      expect(ids(on)).not.toContain(optedOut.id);

      const done = await list('?onboarding_completed=false&limit=100');
      expect(done.items.every((i) => i.onboarding_completed === false)).toBe(
        true,
      );

      const warm = await list('?tier=warm&limit=100');
      expect(warm.items.every((i) => i.tier === 'warm')).toBe(true);
      expect(ids(warm)).toContain(optedIn.id);

      for (const bad of [
        'marketing_opt_in=abc',
        'onboarding_completed=1',
        'tier=lukewarm',
        'page=abc',
        'limit=1.5',
        'page=2.5',
      ]) {
        await http().get(`/leads?${bad}`).set(auth(admin)).expect(400);
      }

      expect(await list('?page=0&limit=5000')).toMatchObject({
        page: 1,
        limit: 100,
      });
      const clampedLow = await list('?page=-4&limit=0');
      expect(clampedLow).toMatchObject({ page: 1, limit: 1 });
      expect(clampedLow.items).toHaveLength(1);
      expect(await list('')).toMatchObject({ page: 1, limit: 25 });

      const past = await list('?page=99999&limit=10');
      expect(past.items).toEqual([]);
      expect(past).toMatchObject({ page: 99999, limit: 10 });
      expect(past.total).toBeGreaterThan(0);
      await http().get('/leads?page=1e300').set(auth(admin)).expect(200);
    });

    it('list is sorted by score desc and pages are stable and disjoint', async () => {
      const all = await list('?limit=100');
      const scores = all.items.map((i) => i.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      expect(all.total).toBeGreaterThanOrEqual(all.items.length);

      const p1 = await list('?limit=2&page=1');
      const p2 = await list('?limit=2&page=2');
      expect([...p1.items, ...p2.items].map((i) => i.user_id)).toEqual(
        all.items.slice(0, 4).map((i) => i.user_id),
      );
    });

    it('summary items match the contract keys exactly', async () => {
      const res = await list('?limit=1');
      expect(Object.keys(res.items[0]).sort()).toEqual(
        [
          'user_id',
          'email',
          'display_name',
          'score',
          'tier',
          'suggested_action',
          'score_computed_at',
          'onboarding_completed',
          'persona',
          'due_date',
          'marketing_opt_in',
          'registered_at',
          'last_active_at',
        ].sort(),
      );
      const d = await detail(res.items[0].user_id);
      expect(Object.keys(d).sort()).toEqual(
        [
          ...Object.keys(res.items[0]),
          'breakdown',
          'onboarding',
          'active_connectors',
          'signals',
        ].sort(),
      );
      expect(JSON.stringify(d)).not.toMatch(/password|hash/i);
    });

    it('admin and disabled accounts are absent from list and stats', async () => {
      const wasAdmin = await registerUser();
      const wasDisabled = await registerUser();
      await submit(wasAdmin).expect(200);
      await submit(wasDisabled).expect(200);
      const before = await stats();

      await promoteToAdmin(pg.env, wasAdmin.email);
      await dataSource.query(
        `UPDATE users SET disabled_at = now() WHERE id = $1`,
        [wasDisabled.id],
      );

      const after = await stats();
      expect(after.total_leads).toBe(before.total_leads - 2);
      expect(after.onboarding.completed).toBe(before.onboarding.completed - 2);

      const list = (
        await http().get('/leads?limit=100').set(auth(admin)).expect(200)
      ).body;
      const ids = list.items.map((i: { user_id: string }) => i.user_id);
      expect(ids).not.toContain(wasAdmin.id);
      expect(ids).not.toContain(wasDisabled.id);
      expect(ids).not.toContain(admin.id);
    });

    it('stats arithmetic matches seeded users, with every enum key present', async () => {
      const before = await stats();

      const a = await registerUser();
      await submit(
        a,
        answers({
          persona: 'apprentice',
          deliverable_type: 'thesis',
          academic_level: 'm2',
          work_tools: ['trello', 'email'],
          blockers: ['writing', 'lack_of_time'],
          acquisition_channel: 'friend',
          marketing_opt_in: true,
          due_date: dateIn(30),
        }),
      ).expect(200);
      await http()
        .post('/lead-signals')
        .set(auth(a))
        .send({ type: 'export_paywall_hit' })
        .expect(204); // 10, hot
      await registerUser(); // B: never started, cold
      const c = await registerUser();
      await submit(
        c,
        answers({
          persona: 'intern',
          deliverable_type: 'internship_report',
          academic_level: 'l3',
          work_tools: [],
          blockers: ['structuring'],
          acquisition_channel: 'school',
          marketing_opt_in: false,
          due_date: dateIn(120),
        }),
      ).expect(200); // 2 + 1 = 3, cold

      const after = await stats();
      expect(new Date(after.generated_at).getTime()).not.toBeNaN();
      expect(after.total_leads - before.total_leads).toBe(3);

      const delta = (
        pick: (s: typeof after) => Record<string, number>,
      ): Record<string, number> => {
        const out: Record<string, number> = {};
        for (const k of Object.keys(pick(after))) {
          out[k] = pick(after)[k] - pick(before)[k];
        }
        return out;
      };

      expect(delta((s) => s.tiers)).toEqual({ hot: 1, warm: 0, cold: 2 });
      expect(delta((s) => s.suggested_actions)).toEqual({
        interview_and_pro_offer: 1,
        scheduled_emails: 0,
        newsletter: 0,
        no_outreach: 2,
      });
      expect(delta((s) => s.onboarding)).toEqual({
        not_started: 1,
        completed: 2,
      });
      expect(after.marketing_opt_in - before.marketing_opt_in).toBe(1);
      expect(after.connected_tool - before.connected_tool).toBe(0);
      expect(delta((s) => s.signals)).toEqual({ export_paywall_hit: 1 });

      const d = (key: string) => delta((s) => s.distributions[key]);
      expect(d('persona')).toEqual({
        apprentice: 1,
        intern: 1,
        student: 0,
        other: 0,
      });
      expect(d('deliverable_type')).toEqual({
        thesis: 1,
        apprenticeship_report: 0,
        internship_report: 1,
        other: 0,
      });
      expect(d('academic_level')).toEqual({ l3: 1, m1: 0, m2: 1, other: 0 });
      expect(d('work_tools')).toEqual({
        trello: 1,
        notion: 0,
        teams: 0,
        slack: 0,
        email: 1,
        drive: 0,
        other: 0,
      });
      expect(d('blockers')).toEqual({
        getting_started: 0,
        finding_past_work: 0,
        structuring: 1,
        writing: 1,
        lack_of_time: 1,
      });
      expect(d('acquisition_channel')).toEqual({
        friend: 1,
        school: 1,
        tiktok: 0,
        instagram: 0,
        linkedin: 0,
        google: 0,
        other: 0,
      });
    });

    it('stats keys match the contract example key for key', async () => {
      const s = await stats();
      expect(Object.keys(s).sort()).toEqual(
        [
          'generated_at',
          'total_leads',
          'tiers',
          'suggested_actions',
          'onboarding',
          'marketing_opt_in',
          'connected_tool',
          'signals',
          'distributions',
        ].sort(),
      );
      expect(Object.keys(s.tiers).sort()).toEqual(['cold', 'hot', 'warm']);
      expect(Object.keys(s.suggested_actions).sort()).toEqual([
        'interview_and_pro_offer',
        'newsletter',
        'no_outreach',
        'scheduled_emails',
      ]);
      expect(Object.keys(s.onboarding).sort()).toEqual([
        'completed',
        'not_started',
      ]);
      expect(Object.keys(s.signals)).toEqual(['export_paywall_hit']);
      expect(Object.keys(s.distributions).sort()).toEqual([
        'academic_level',
        'acquisition_channel',
        'blockers',
        'deliverable_type',
        'persona',
        'work_tools',
      ]);
    });
  });
});
