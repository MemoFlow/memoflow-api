import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Client } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Connection } from 'mongoose';
import type {
  LlmCompletion,
  LlmCompletionRequest,
} from './../src/domain/ai/llm-gateway.port';
import type { PlanningJobRepository } from './../src/domain/context/planning-job.repository';
import type { HandleContextResultChunkUseCase } from './../src/application/context/handle-context-result-chunk.use-case';
import { startMongoMemory, MongoTestEnv } from './utils/mongo-memory';
import {
  describeWithDocker,
  startPgContainer,
  PgTestEnv,
} from './utils/pg-testcontainer';
import { startRedisContainer, RedisTestEnv } from './utils/redis-testcontainer';
import { registerUser } from './utils/register-user';

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const FEATURE_TYPES = [
  'expand',
  'planning',
  'rewrite',
  'suggestion',
  'summarize',
];

/** Scripted `LlmGateway`: captures every request, replies from `reply`. */
class ScriptedGateway {
  requests: LlmCompletionRequest[] = [];
  reply: (req: LlmCompletionRequest) => unknown = () => ({});

  isAvailable(): boolean {
    return true;
  }

  complete(req: LlmCompletionRequest): Promise<LlmCompletion> {
    this.requests.push(req);
    return Promise.resolve({
      json: this.reply(req),
      model: 'scripted/model',
      finishReason: 'stop',
    });
  }
}

/** Scripted legacy `ContextGatherer` standing in for connector context. */
class ScriptedGatherer {
  context: Record<string, unknown> = { chunks: [] };

  gather(): Promise<Record<string, unknown>> {
    return Promise.resolve(this.context);
  }
}

interface Finished {
  status: string;
  result: Record<string, unknown> | null;
  contextUsed: Record<string, unknown> | null;
  errorMessage: string | null;
}

interface Connector {
  provider: string;
  content: string;
}

interface RetrievalMeta {
  sources: Array<{
    id: string;
    type: string;
    title: string;
    ref: string;
    truncated: boolean;
  }>;
  matched: number;
  used: number;
  dropped: number;
  truncated: number;
  failed: boolean;
}

interface Account {
  token: string;
  userId: string;
}

interface Run {
  prompt: string;
  documentId?: string;
  sectionId?: string;
  connectors?: Connector[];
}

describeWithDocker()('RAG pipeline (e2e)', () => {
  let app: INestApplication<App>;
  let pg: PgTestEnv;
  let mongo: MongoTestEnv;
  let redis: RedisTestEnv;
  const gateway = new ScriptedGateway();
  const gatherer = new ScriptedGatherer();
  let jobRepository: PlanningJobRepository;
  let chunkHandler: HandleContextResultChunkUseCase;
  let migrationSnapshots: {
    /** Active prompts after the migrations ran on a fresh database. */
    fresh: Array<{ feature_type: string; version: string }>;
    /** The same after replaying PromptsV3 with an admin's rewrite active. */
    adminKept: Array<{ feature_type: string; version: string }>;
    /** v3 rows with their activation after that replay. */
    v3Rows: Array<{ feature_type: string; is_active: boolean }>;
  };
  let seq = 0;

  async function sql<T extends object = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = new Client({
      host: pg.env.POSTGRES_HOST,
      port: Number(pg.env.POSTGRES_PORT),
      user: pg.env.POSTGRES_USER,
      password: pg.env.POSTGRES_PASSWORD,
      database: pg.env.POSTGRES_DB,
    });
    await client.connect();
    try {
      return (await client.query(text, params)).rows as T[];
    } finally {
      await client.end();
    }
  }

  async function newAccount(label: string): Promise<Account> {
    seq += 1;
    const payload = {
      email: `${label}-${seq}@example.com`,
      password: 'correct-horse-battery-staple',
      display_name: 'Test User',
    };
    await registerUser(app, payload);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);
    const token = login.body.accessToken as string;
    const me = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return { token, userId: me.body.id as string };
  }

  async function createDocument(
    account: Account,
    title: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ title, docType: 'blog' })
      .expect(201);
    return res.body.id as string;
  }

  async function createSection(
    account: Account,
    documentId: string,
    title: string,
    content: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/documents/${documentId}/sections`)
      .set('Authorization', `Bearer ${account.token}`)
      .send({ title, content })
      .expect(201);
    return res.body.id as string;
  }

  /** The legacy in-process path: submit over HTTP, worker plans it. */
  async function runLegacy(account: Account, run: Run): Promise<Finished> {
    gatherer.context = { chunks: run.connectors ?? [] };
    const submit = await request(app.getHttpServer())
      .post('/planning-jobs')
      .set('Authorization', `Bearer ${account.token}`)
      .send({
        prompt: run.prompt,
        documentId: run.documentId,
        sectionId: run.sectionId,
      })
      .expect(202);
    const jobId = submit.body.job_id as string;
    const deadline = Date.now() + 20_000;
    for (;;) {
      const res = await request(app.getHttpServer())
        .get(`/planning-jobs/${jobId}`)
        .set('Authorization', `Bearer ${account.token}`)
        .expect(200);
      if (res.body.status === 'completed' || res.body.status === 'failed') {
        return {
          status: res.body.status as string,
          result: res.body.result as Record<string, unknown> | null,
          contextUsed: res.body.context_used as Record<string, unknown> | null,
          errorMessage: res.body.error_message as string | null,
        };
      }
      if (Date.now() > deadline) throw new Error('job did not finish');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /**
   * The RabbitMQ result path: the job is created and claimed `gathering`,
   * then the context engine's chunks reach the same use-case the AMQP
   * consumer calls. The binding is written straight to the repository, so
   * it is NOT validated by the submit use-case: retrieval has to hold on its
   * own.
   */
  async function runViaChunks(account: Account, run: Run): Promise<Finished> {
    const created = await jobRepository.create({
      userId: account.userId,
      prompt: run.prompt,
      connectors: [],
      documentId: run.documentId ?? null,
      sectionId: run.sectionId ?? null,
    });
    await jobRepository.claimForGathering(created.id);
    let sequence = 0;
    for (const connector of run.connectors ?? []) {
      await chunkHandler.execute({
        chunk: {
          schemaVersion: 1,
          jobId: created.id,
          userId: account.userId,
          sequence: sequence++,
          type: 'data',
          data: { provider: connector.provider, content: connector.content },
        },
      });
    }
    const done = await chunkHandler.execute({
      chunk: {
        schemaVersion: 1,
        jobId: created.id,
        userId: account.userId,
        sequence: sequence++,
        type: 'status',
        status: { phase: 'completed' },
      },
    });
    const job = done.job!;
    return {
      status: job.status,
      result: job.result,
      contextUsed: job.contextUsed,
      errorMessage: job.errorMessage,
    };
  }

  const retrievalOf = (finished: Finished): RetrievalMeta =>
    finished.contextUsed!.retrieval as RetrievalMeta;

  /** What retrieval recorded and the planner returned, not the prompt. */
  const storedSections = (finished: Finished): string =>
    JSON.stringify({
      retrieval: finished.contextUsed?.retrieval,
      result: finished.result,
    });

  const lastUser = (): string =>
    gateway.requests[gateway.requests.length - 1].user;

  const planOk = (): unknown => ({
    suggestions: ['Do the thing'],
    outline: 'Outline',
    sources: [],
  });

  beforeAll(async () => {
    pg = await startPgContainer();
    mongo = await startMongoMemory();
    redis = await startRedisContainer();
    Object.assign(process.env, pg.env, redis.env, {
      MONGODB_URI: mongo.uri,
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars-long',
      JWT_EXPIRES_IN: '15m',
      COMPOSIO_API_KEY: 'test-only-composio-key',
      COMPOSIO_AUTH_CONFIG_IDS: 'trello:ac_test,notion:ac_test,github:ac_test',
      COMPOSIO_WEBHOOK_SECRET: 'test-only-composio-webhook-secret',
      // A key makes the planner factory pick the gateway-backed planner;
      // LLM_GATEWAY itself is replaced below, so no provider is ever called.
      OPENROUTER_API_KEY: 'e2e-not-a-real-key',
      AI_MAX_INPUT_CHARS: '20000',
    });

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

    const activePrompts = async () => {
      const rows: Array<{ feature_type: string; version: string }> =
        await dataSource.query(
          `SELECT feature_type, version FROM prompts WHERE is_active = true ORDER BY feature_type`,
        );
      return rows;
    };
    await dataSource.initialize();
    await dataSource.runMigrations();
    const fresh = await activePrompts();

    // Replay PromptsV3 as if it had never run: v2 active everywhere, except
    // that an admin has since activated a prompt of their own for rewrite.
    await dataSource.query(`DELETE FROM prompts WHERE version = 'v3'`);
    await dataSource.query(`UPDATE prompts SET is_active = false`);
    await dataSource.query(
      `UPDATE prompts SET is_active = true WHERE version = 'v2'`,
    );
    await dataSource.query(
      `INSERT INTO prompts (feature_type, version, system_template, template, user_invocable, is_active)
       VALUES ('rewrite', 'admin-1', 'Sys <untrusted_{{nonce}}>', '<untrusted_{{nonce}}>{{content}}</untrusted_{{nonce}}>', true, false)`,
    );
    // Two statements: the partial unique index allows one active row per type
    // at every moment, so the old one goes off before the new one goes on.
    await dataSource.query(
      `UPDATE prompts SET is_active = false WHERE feature_type = 'rewrite'`,
    );
    await dataSource.query(
      `UPDATE prompts SET is_active = true WHERE version = 'admin-1'`,
    );
    await dataSource.query(
      `DELETE FROM migrations WHERE name LIKE 'PromptsV3%'`,
    );
    await dataSource.runMigrations();
    const adminKept = await activePrompts();
    const v3Rows: Array<{ feature_type: string; is_active: boolean }> =
      await dataSource.query(
        `SELECT feature_type, is_active FROM prompts WHERE version = 'v3' ORDER BY feature_type`,
      );
    // Leave the database the way the other tests expect it: v3 active.
    await dataSource.query(
      `UPDATE prompts SET is_active = false WHERE feature_type = 'rewrite'`,
    );
    await dataSource.query(
      `UPDATE prompts SET is_active = true WHERE feature_type = 'rewrite' AND version = 'v3'`,
    );
    await dataSource.destroy();
    migrationSnapshots = { fresh, adminKept, v3Rows };

    const { AppModule } = await import('./../src/app.module');
    const { LLM_GATEWAY } = await import('./../src/domain/ai/llm-gateway.port');
    const { CONTEXT_GATHERER } =
      await import('./../src/domain/context/context-gatherer.port');
    const { PLANNING_JOB_REPOSITORY } =
      await import('./../src/domain/context/planning-job.repository');
    const { HandleContextResultChunkUseCase: HandleChunk } =
      await import('./../src/application/context/handle-context-result-chunk.use-case');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LLM_GATEWAY)
      .useValue(gateway)
      .overrideProvider(CONTEXT_GATHERER)
      .useValue(gatherer)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    jobRepository = app.get<PlanningJobRepository>(PLANNING_JOB_REPOSITORY);
    chunkHandler = app.get(HandleChunk);
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await pg?.container.stop();
    await mongo?.server.stop();
    await redis?.container.stop();
  });

  beforeEach(() => {
    gateway.requests = [];
    gateway.reply = planOk;
    gatherer.context = { chunks: [] };
  });

  describe('migrations', () => {
    it('make v3 the active prompt for all five types when v2 was active', async () => {
      expect(migrationSnapshots.fresh).toEqual(
        FEATURE_TYPES.map((feature_type) => ({ feature_type, version: 'v3' })),
      );
      const v2 = await sql<{ feature_type: string }>(
        `SELECT feature_type FROM prompts WHERE version = 'v2' AND is_active = true`,
      );
      expect(v2).toEqual([]);
    });

    it('does not override a prompt an admin activated, and inserts v3 inactive for that type', () => {
      expect(migrationSnapshots.adminKept).toEqual([
        { feature_type: 'expand', version: 'v3' },
        { feature_type: 'planning', version: 'v3' },
        { feature_type: 'rewrite', version: 'admin-1' },
        { feature_type: 'suggestion', version: 'v3' },
        { feature_type: 'summarize', version: 'v3' },
      ]);
      expect(migrationSnapshots.v3Rows).toContainEqual({
        feature_type: 'rewrite',
        is_active: false,
      });
      expect(migrationSnapshots.v3Rows).toHaveLength(5);
    });

    it('adds a search_vector column with a GIN index', async () => {
      const column = await sql<{ is_generated: string }>(
        `SELECT is_generated FROM information_schema.columns WHERE table_name = 'sections' AND column_name = 'search_vector'`,
      );
      expect(column).toEqual([{ is_generated: 'ALWAYS' }]);
      const index = await sql<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'IDX_sections_search_vector'`,
      );
      expect(index[0].indexdef).toMatch(/USING gin/);
    });

    it('lets a very large section be saved without exceeding the tsvector limit', async () => {
      const account = await newAccount('big-section');
      const documentId = await createDocument(account, 'Big');
      // Straight into Postgres: over HTTP the body would hit the JSON limit.
      await sql(
        `INSERT INTO sections (document_id, title, content, "order") VALUES ($1, 'Huge', 'needle ' || repeat('lorem ipsum dolor ', 100000), 0)`,
        [documentId],
      );
      const rows = await sql<{ n: string }>(
        `SELECT count(*) AS n FROM sections WHERE document_id = $1 AND search_vector @@ plainto_tsquery('simple', 'needle')`,
        [documentId],
      );
      expect(rows[0].n).toBe('1');
    });
  });

  describe.each([
    ['legacy in-process', 'legacy'],
    ['RabbitMQ result chunks', 'chunks'],
  ] as const)('planning jobs (%s transport)', (_label, transport) => {
    const run = (account: Account, input: Run): Promise<Finished> =>
      transport === 'legacy'
        ? runLegacy(account, input)
        : runViaChunks(account, input);

    it("never retrieves another user's matching section, even when the prompt quotes it exactly", async () => {
      const owner = await newAccount('owner');
      const other = await newAccount('other');
      const secretText =
        'The zebra launch codename is PROJECT-ALPHA-ZEBRA-7731 and costs 4200 euros';
      const ownerDoc = await createDocument(owner, 'Owner private doc');
      await createSection(owner, ownerDoc, 'Zebra launch plan', secretText);
      const otherDoc = await createDocument(other, 'Other doc');
      const otherSection = await createSection(
        other,
        otherDoc,
        'Giraffe notes',
        'The giraffe launch is about tall animals',
      );

      // The prompt quotes the owner's text exactly; the job is unbound.
      const unbound = await run(other, { prompt: secretText });
      // Bound to the caller's own document.
      const bound = await run(other, {
        prompt: secretText,
        documentId: otherDoc,
      });
      // Bound to the owner's document: submit validation (legacy) would 404;
      // on the chunk path the repository takes it as is. Both must still
      // hold, so test the chunk path with it and the legacy path through the
      // HTTP check.
      if (transport === 'chunks') {
        const stolenBinding = await run(other, {
          prompt: secretText,
          documentId: ownerDoc,
        });
        expect(storedSections(stolenBinding)).not.toContain('ZEBRA-7731');
        expect(
          retrievalOf(stolenBinding).sources.every(
            (s) => s.ref === otherSection,
          ),
        ).toBe(true);
      } else {
        await request(app.getHttpServer())
          .post('/planning-jobs')
          .set('Authorization', `Bearer ${other.token}`)
          .send({ prompt: secretText, documentId: ownerDoc })
          .expect(404);
      }

      expect(gateway.requests.length).toBeGreaterThanOrEqual(2);
      for (const req of gateway.requests) {
        // The prompt itself quotes the text, so only the Sources block (the
        // retrieved material) is checked for the body; titles are checked
        // across the whole request.
        const sources = req.user.split('\n\nSources:\n')[1];
        expect(sources).toBeDefined();
        expect(sources).not.toContain('PROJECT-ALPHA-ZEBRA-7731');
        expect(sources).not.toContain('4200 euros');
        const sent = JSON.stringify(req);
        expect(sent).not.toContain('Zebra launch plan');
        expect(sent).not.toContain('Owner private doc');
      }
      for (const finished of [unbound, bound]) {
        expect(finished.status).toBe('completed');
        // The job's own `prompt` legitimately holds the text; what retrieval
        // recorded and what the model returned must not.
        const json = storedSections(finished);
        expect(json).not.toContain('ZEBRA-7731');
        expect(json).not.toContain('Zebra launch plan');
      }
      // The caller's own bound document is still retrieved.
      expect(retrievalOf(bound).sources.map((s) => s.ref)).toEqual([
        otherSection,
      ]);
      // Only the caller's own section can come back (it shares common words).
      expect(
        retrievalOf(unbound).sources.every((s) => s.ref === otherSection),
      ).toBe(true);

      // And the owner does see their own section for the same prompt.
      const ownerRun = await run(owner, { prompt: secretText });
      expect(ownerRun.status).toBe('completed');
      expect(lastUser()).toContain('PROJECT-ALPHA-ZEBRA-7731');
    }, 60_000);

    it('puts the bound document first, then connector sources, then other documents', async () => {
      const account = await newAccount('order');
      const bound = await createDocument(account, 'Bound doc');
      const intro = await createSection(
        account,
        bound,
        'Intro',
        'Nothing relevant here',
      );
      const pricing = await createSection(
        account,
        bound,
        'Pricing',
        'We charge a quokka fee',
      );
      const outro = await createSection(account, bound, 'Outro', 'Goodbye');
      const elsewhere = await createDocument(account, 'Elsewhere');
      const other = await createSection(
        account,
        elsewhere,
        'Quokka facts',
        'quokka quokka quokka',
      );

      const finished = await run(account, {
        prompt: 'Tell me about the quokka fee',
        documentId: bound,
        connectors: [{ provider: 'notion', content: 'notion page text' }],
      });

      expect(finished.status).toBe('completed');
      const retrieval = retrievalOf(finished);
      expect(retrieval.sources.map((s) => [s.id, s.type, s.ref])).toEqual([
        // Matching section of the bound document, then its other sections
        // by order, then the connector, then the other document's match.
        ['S1', 'section', pricing],
        ['S2', 'section', intro],
        ['S3', 'section', outro],
        ['S4', 'connector', 'notion'],
        ['S5', 'section', other],
      ]);
      expect(retrieval).toMatchObject({
        matched: 2,
        used: 5,
        dropped: 0,
        truncated: 0,
        failed: false,
      });
      const user = lastUser();
      expect(user.indexOf('[S1] section: Pricing')).toBeGreaterThan(-1);
      expect(user.indexOf('[S4] connector: notion')).toBeLessThan(
        user.indexOf('[S5] section: Quokka facts'),
      );
    }, 60_000);

    it('puts the bound section first', async () => {
      const account = await newAccount('bound-section');
      const documentId = await createDocument(account, 'Doc');
      const first = await createSection(account, documentId, 'First', 'wombat');
      const second = await createSection(account, documentId, 'Second', 'none');
      const third = await createSection(account, documentId, 'Third', 'none');

      const finished = await run(account, {
        prompt: 'wombat',
        sectionId: third,
      });

      expect(retrievalOf(finished).sources.map((s) => s.ref)).toEqual([
        third,
        first,
        second,
      ]);
    }, 60_000);

    it('gives a bound job its document even when no term matches', async () => {
      const account = await newAccount('no-match');
      const documentId = await createDocument(account, 'Bound');
      const a = await createSection(account, documentId, 'A', 'alpha text');
      const b = await createSection(account, documentId, 'B', 'beta text');
      const elsewhere = await createDocument(account, 'Elsewhere');
      await createSection(account, elsewhere, 'C', 'gamma text');

      const finished = await run(account, {
        prompt: 'zzzzzz qqqqqq',
        documentId,
      });

      expect(finished.status).toBe('completed');
      expect(retrievalOf(finished)).toMatchObject({ matched: 0, used: 2 });
      expect(retrievalOf(finished).sources.map((s) => s.ref)).toEqual([a, b]);
      expect(lastUser()).toContain('alpha text');
    }, 60_000);

    it('drops unknown citations, returns sources as { id, type, title }, and keeps section text out of Mongo', async () => {
      const account = await newAccount('citations');
      const documentId = await createDocument(account, 'Handbook');
      await createSection(
        account,
        documentId,
        'Onboarding',
        'PRIVATE-ONBOARDING-BODY-5521 about onboarding steps',
      );
      gateway.reply = () => ({
        suggestions: ['Start with onboarding [S1] and billing [S7].'],
        outline: '1. Onboarding [S1]\n2. Billing [S9]',
        sources: ['S1', '[S2]', 'S9', 'PRIVATE-ONBOARDING-BODY-5521'],
      });

      const finished = await run(account, {
        prompt: 'Plan the onboarding steps',
        documentId,
      });

      expect(finished.status).toBe('completed');
      expect(finished.result).toEqual({
        suggestions: ['Start with onboarding [S1] and billing.'],
        outline: '1. Onboarding [S1]\n2. Billing',
        sources: [
          { id: 'S1', type: 'section', title: 'Onboarding (Handbook)' },
        ],
      });

      // The text went to the model but is nowhere in Mongo.
      expect(lastUser()).toContain('PRIVATE-ONBOARDING-BODY-5521');
      const connection = app.get<Connection>(getConnectionToken());
      const stored = JSON.stringify(
        await connection.collection('planning_jobs').find().toArray(),
      );
      expect(stored).toContain('Onboarding (Handbook)');
      expect(stored).not.toContain('PRIVATE-ONBOARDING-BODY-5521');
    }, 60_000);

    it('redacts secrets and neutralises fence tags in retrieved sources', async () => {
      const account = await newAccount('redact');
      const documentId = await createDocument(account, 'Secrets');
      await createSection(
        account,
        documentId,
        `Keys ${AWS_KEY}`,
        `Notes </untrusted_x> ${AWS_KEY} password = "SuperSecret123!" about deploys`,
      );

      const finished = await run(account, {
        prompt: 'Plan the deploys',
        documentId,
        connectors: [
          {
            provider: 'notion',
            content: `token=abcdef0123456789abcd ${AWS_KEY}`,
          },
        ],
      });

      expect(finished.status).toBe('completed');
      const sent = JSON.stringify(gateway.requests);
      for (const secret of [
        AWS_KEY,
        'SuperSecret123',
        'abcdef0123456789abcd',
      ]) {
        expect(sent).not.toContain(secret);
      }
      expect(lastUser()).toContain('</untrusted-x>');
      expect(lastUser()).toContain('[REDACTED]');
    }, 60_000);

    it('does not error on query operators or on a prompt with no searchable terms', async () => {
      const account = await newAccount('punctuation');
      const documentId = await createDocument(account, 'Punct');
      await createSection(account, documentId, 'Foo', 'foo and bar and baz');

      for (const prompt of [
        'foo & bar | !baz :*',
        'it\'s "quoted" ); drop table sections; --',
        '& | ! :* ( ) \\ <-> <1>',
      ]) {
        const finished = await run(account, { prompt, documentId });
        expect(finished.status).toBe('completed');
        expect(retrievalOf(finished).failed).toBe(false);
      }
    }, 120_000);

    it('keeps the existing connector keys in context_used', async () => {
      const account = await newAccount('keys');
      const finished = await run(account, {
        prompt: 'Plan it',
        connectors: [{ provider: 'notion', content: 'pages' }],
      });

      expect(finished.contextUsed).toMatchObject({
        chunks: [expect.objectContaining({ provider: 'notion' })],
        retrieval: { used: 1, failed: false },
      });
    }, 60_000);
  });

  describe('suggestions: light context', () => {
    it('sends the document title and the neighbouring headings, nothing else', async () => {
      const account = await newAccount('light');
      const documentId = await createDocument(account, 'Quarterly review');
      await createSection(account, documentId, 'Opening', 'OPENING-BODY-TEXT');
      const middle = await createSection(
        account,
        documentId,
        'Findings',
        'The middle section body',
      );
      await createSection(account, documentId, 'Closing', 'CLOSING-BODY-TEXT');
      gateway.reply = () => ({ suggested_text: 'A better middle.' });

      await request(app.getHttpServer())
        .post(`/sections/${middle}/suggestions`)
        .set('Authorization', `Bearer ${account.token}`)
        .send({ featureType: 'suggestion' })
        .expect(201);

      const { user, system } = gateway.requests[0];
      const nonce = /<untrusted_([0-9a-f]{32})>/.exec(system)![1];
      expect(user).toBe(
        `Context:\n<untrusted_${nonce}>\nDocument: Quarterly review\nPrevious section: Opening\nNext section: Closing\n</untrusted_${nonce}>\n\nText:\n<untrusted_${nonce}>\nThe middle section body\n</untrusted_${nonce}>`,
      );
      expect(user).not.toContain('OPENING-BODY-TEXT');
      expect(user).not.toContain('CLOSING-BODY-TEXT');
    }, 60_000);
  });
});
