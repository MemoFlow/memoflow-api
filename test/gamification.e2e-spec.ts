import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';

// Booting AppModule requires a live PostgreSQL (TypeORM connects at init),
// which Testcontainers can only provide when a Docker daemon is present.
describeWithDocker()('Gamification (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;

  async function registerAndLogin(email: string): Promise<string> {
    const payload = {
      email,
      password: 'correct-horse-battery-staple',
      display_name: 'Test User',
    };
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(payload)
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);

    return loginRes.body.accessToken as string;
  }

  async function createDocument(
    token: string,
    title = 'Q3 Planning',
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title, docType: 'blog' })
      .expect(201);
    return res.body.id as string;
  }

  async function createSection(
    token: string,
    documentId: string,
    content = 'hello world',
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Intro', content })
      .expect(201);
    return res.body.id as string;
  }

  async function getMe(token: string): Promise<{
    xp: number;
    level: number;
    milestones: { milestone_type: string; document_id: string }[];
    today_missions: {
      mission: { code: string };
      progress: number;
      completed: boolean;
    }[];
  }> {
    const res = await request(app.getHttpServer())
      .get('/gamification/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as {
      xp: number;
      level: number;
      milestones: { milestone_type: string; document_id: string }[];
      today_missions: {
        mission: { code: string };
        progress: number;
        completed: boolean;
      }[];
    };
  }

  /**
   * `POST /documents`, `/sections`, and `PATCH .../sections/:id` all emit
   * their gamification event via `EventEmitter2.emit()` — fire-and-forget,
   * not awaited by the request — so the milestone/mission-progress write it
   * triggers can still be in flight when the triggering HTTP response comes
   * back. Poll `GET /gamification/me` until `predicate` holds (or time out)
   * instead of asserting once, immediately after the mutating call.
   */
  async function waitForGamification(
    token: string,
    predicate: (me: Awaited<ReturnType<typeof getMe>>) => boolean,
    { timeoutMs = 5_000, intervalMs = 100 } = {},
  ): Promise<Awaited<ReturnType<typeof getMe>>> {
    const deadline = Date.now() + timeoutMs;
    let last: Awaited<ReturnType<typeof getMe>> | undefined;
    while (Date.now() < deadline) {
      last = await getMe(token);
      if (predicate(last)) {
        return last;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `waitForGamification: predicate never held within ${timeoutMs}ms — last state: ${JSON.stringify(last)}`,
    );
  }

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    Object.assign(process.env, pg.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
      COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
    });

    // Apply migrations against the fresh test container before boot —
    // synchronize stays false everywhere, including tests.
    const dataSourceModule =
      await import('./../src/infrastructure/persistence/typeorm.data-source');
    const dataSource = dataSourceModule.default;
    dataSource.setOptions({
      host: pg.env.POSTGRES_HOST,
      port: Number(pg.env.POSTGRES_PORT),
      username: pg.env.POSTGRES_USER,
      password: pg.env.POSTGRES_PASSWORD,
      database: pg.env.POSTGRES_DB,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    // Seed one daily mission active "today" so mission-progress endpoints
    // have something to exercise — mirrors `scripts/seed.ts`'s idempotent
    // shape but scoped to this suite's own container.
    const { DailyMissionOrmEntity } =
      await import('./../src/infrastructure/persistence/gamification/daily-mission.orm-entity');
    const dailyMissionRepository = dataSource.getRepository(
      DailyMissionOrmEntity,
    );
    await dailyMissionRepository.save(
      dailyMissionRepository.create({
        code: 'create-2-sections',
        description: 'Create 2 sections today',
        xpReward: 15,
        criteria: { event: 'section.created', target: 2 },
        activeDate: new Date(),
      }),
    );
    await dataSource.destroy();

    // Import late so ConfigModule validation sees the test env vars.
    const { AppModule } = await import('./../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.container.stop();
    await mongo?.server.stop();
  });

  it('GET /gamification/me requires a token (401 without one)', async () => {
    await request(app.getHttpServer()).get('/gamification/me').expect(401);
  });

  it('GET /gamification/leaderboard requires a token (401 without one)', async () => {
    await request(app.getHttpServer())
      .get('/gamification/leaderboard')
      .expect(401);
  });

  it('awards the document_created milestone and 50 xp on document creation', async () => {
    const token = await registerAndLogin('milestone-doc@example.com');

    await createDocument(token, 'First Doc');
    // The gamification event is fire-and-forget (`EventEmitter2.emit()` is
    // not awaited by the request), so poll instead of asserting once
    // immediately after the triggering call. The predicate checks `xp`
    // (not just milestone presence): `GetMyGamificationUseCase` reads the
    // user row and the milestones list via two separate non-transactional
    // queries, so a poll landing between "milestone row visible" and "xp
    // update visible" can observe the milestone with a stale xp — polling
    // on `xp` itself (like the leaderboard tests below) is race-free
    // because it only returns once that same read reflects the award.
    const me = await waitForGamification(token, (state) => state.xp >= 50);

    expect(me.xp).toBeGreaterThanOrEqual(50);
    expect(
      me.milestones.some((m) => m.milestone_type === 'document_created'),
    ).toBe(true);
  });

  it('does not double-award document_created for a second document by the same user', async () => {
    const token = await registerAndLogin('milestone-doc-twice@example.com');
    const documentCreatedCount = (milestones: { milestone_type: string }[]) =>
      milestones.filter((m) => m.milestone_type === 'document_created').length;

    await createDocument(token, 'Doc One');
    const afterFirst = await waitForGamification(
      token,
      (state) => documentCreatedCount(state.milestones) >= 1,
    );
    expect(documentCreatedCount(afterFirst.milestones)).toBe(1);

    await createDocument(token, 'Doc Two');
    const afterSecond = await waitForGamification(
      token,
      (state) => documentCreatedCount(state.milestones) >= 2,
    );
    // `document_created` is keyed on (user, document, type) — a second
    // *different* document still gets its own row (once), it just never
    // stacks beyond one-per-document.
    expect(documentCreatedCount(afterSecond.milestones)).toBe(2);
  });

  it('awards first_section on the first section.created for a document, not repeatedly', async () => {
    const token = await registerAndLogin('milestone-section@example.com');
    const documentId = await createDocument(token);

    await createSection(token, documentId, 'one');
    await createSection(token, documentId, 'two');

    const me = await waitForGamification(token, (state) =>
      state.milestones.some((m) => m.milestone_type === 'first_section'),
    );
    const firstSectionMilestones = me.milestones.filter(
      (m) => m.milestone_type === 'first_section',
    );
    expect(firstSectionMilestones).toHaveLength(1);
    expect(firstSectionMilestones[0].document_id).toBe(documentId);
  });

  it('awards section_goal only once a section reaches the word-count threshold', async () => {
    const token = await registerAndLogin('milestone-goal@example.com');
    const documentId = await createDocument(token);
    const sectionId = await createSection(token, documentId, 'short');

    await request(app.getHttpServer())
      .patch(`/documents/${documentId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'still short' })
      .expect(200);

    // first_section already fired for this document — wait for that before
    // asserting section_goal's absence, so we're not just observing a
    // not-yet-processed listener.
    const beforeGoal = await waitForGamification(token, (state) =>
      state.milestones.some((m) => m.milestone_type === 'first_section'),
    );
    expect(
      beforeGoal.milestones.some((m) => m.milestone_type === 'section_goal'),
    ).toBe(false);

    const longContent = new Array(101).fill('word').join(' ');
    await request(app.getHttpServer())
      .patch(`/documents/${documentId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: longContent })
      .expect(200);

    const afterGoal = await waitForGamification(token, (state) =>
      state.milestones.some((m) => m.milestone_type === 'section_goal'),
    );
    expect(
      afterGoal.milestones.some((m) => m.milestone_type === 'section_goal'),
    ).toBe(true);
  });

  it('GET /gamification/me reflects seeded mission progress across section.created events', async () => {
    const token = await registerAndLogin('mission-progress@example.com');
    const documentId = await createDocument(token);
    const missionOf = (state: Awaited<ReturnType<typeof getMe>>) =>
      state.today_missions.find((m) => m.mission.code === 'create-2-sections');

    const beforeAny = await getMe(token);
    const seededMission = missionOf(beforeAny);
    expect(seededMission).toBeDefined();
    expect(seededMission?.progress).toBe(0);
    expect(seededMission?.completed).toBe(false);

    await createSection(token, documentId, 'section a');
    const afterOne = await waitForGamification(
      token,
      (state) => (missionOf(state)?.progress ?? 0) >= 1,
    );
    const afterOneMission = missionOf(afterOne);
    expect(afterOneMission?.progress).toBe(1);
    expect(afterOneMission?.completed).toBe(false);

    await createSection(token, documentId, 'section b');
    const afterTwo = await waitForGamification(
      token,
      (state) => missionOf(state)?.completed === true,
    );
    const afterTwoMission = missionOf(afterTwo);
    expect(afterTwoMission?.progress).toBe(2);
    expect(afterTwoMission?.completed).toBe(true);
  });

  it('GET /gamification/leaderboard orders by xp descending and never leaks email/passwordHash', async () => {
    const lowToken = await registerAndLogin('leaderboard-low@example.com');
    const highToken = await registerAndLogin('leaderboard-high@example.com');

    // One document (50 xp) for the low scorer, two (100 xp) for the high
    // scorer — enough of a gap that ordering is unambiguous regardless of
    // what other tests in this file have already awarded these two users.
    await createDocument(lowToken, 'Low Scorer Doc');
    await createDocument(highToken, 'High Scorer Doc 1');
    await createDocument(highToken, 'High Scorer Doc 2');
    // Wait for both awards to land before reading the leaderboard.
    await waitForGamification(lowToken, (state) => state.xp >= 50);
    await waitForGamification(highToken, (state) => state.xp >= 100);

    const res = await request(app.getHttpServer())
      .get('/gamification/leaderboard?limit=50')
      .set('Authorization', `Bearer ${lowToken}`)
      .expect(200);

    const entries = res.body as {
      user_id: string;
      display_name: string;
      xp: number;
      level: number;
    }[];

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty('email');
      expect(entry).not.toHaveProperty('password_hash');
      expect(entry).not.toHaveProperty('passwordHash');
    }
    // Non-increasing xp ordering across the whole page.
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i - 1].xp).toBeGreaterThanOrEqual(entries[i].xp);
    }
  });

  it('GET /gamification/leaderboard clamps a limit above the max instead of erroring', async () => {
    const token = await registerAndLogin('leaderboard-clamp-high@example.com');

    const res = await request(app.getHttpServer())
      .get('/gamification/leaderboard?limit=9999')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Clamped down to MAX_LEADERBOARD_LIMIT (50), never erroring and never
    // returning more than that regardless of how many users exist by now.
    expect((res.body as unknown[]).length).toBeLessThanOrEqual(50);
  });

  it('GET /gamification/leaderboard clamps a zero/negative limit up to the minimum instead of erroring', async () => {
    const token = await registerAndLogin('leaderboard-clamp-low@example.com');

    const zeroRes = await request(app.getHttpServer())
      .get('/gamification/leaderboard?limit=0')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((zeroRes.body as unknown[]).length).toBeLessThanOrEqual(1);

    const negativeRes = await request(app.getHttpServer())
      .get('/gamification/leaderboard?limit=-5')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((negativeRes.body as unknown[]).length).toBeLessThanOrEqual(1);
  });

  it('GET /gamification/leaderboard rejects a non-numeric limit with 400', async () => {
    const token = await registerAndLogin('leaderboard-bad-limit@example.com');

    await request(app.getHttpServer())
      .get('/gamification/leaderboard?limit=not-a-number')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
