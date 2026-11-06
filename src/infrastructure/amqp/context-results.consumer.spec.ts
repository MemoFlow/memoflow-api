import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { HandleContextResultChunkUseCase } from '../../application/context/handle-context-result-chunk.use-case';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  ContextResultsConsumer,
  parseContextResultChunk,
} from './context-results.consumer';
import { RabbitMqConnectionProvider } from './rabbitmq-connection.provider';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

function makeChannel() {
  return {
    waitForConnect: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    ack: jest.fn(),
    nack: jest.fn(),
  };
}

function makeConnectionProvider(
  channel: ReturnType<typeof makeChannel>,
): RabbitMqConnectionProvider {
  const connection = { createChannel: jest.fn().mockReturnValue(channel) };
  return {
    getConnection: () => connection,
  } as unknown as RabbitMqConnectionProvider;
}

function makeMsg(body: unknown, raw = false): { content: Buffer } {
  const content = raw
    ? Buffer.from(body as string, 'utf-8')
    : Buffer.from(JSON.stringify(body), 'utf-8');
  return { content };
}

function makeJob(overrides: Partial<PlanningJob> = {}): PlanningJob {
  return new PlanningJob({
    id: 'job-1',
    userId: 'user-1',
    documentId: null,
    sectionId: null,
    status: JobStatus.Gathering,
    prompt: 'Plan my chapter',
    connectors: ['trello'],
    result: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  });
}

const validDataChunkWire = {
  schema_version: 1,
  job_id: 'job-1',
  user_id: 'user-1',
  sequence: 0,
  type: 'data',
  data: { provider: 'trello', content: '{}', token_estimate: 10 },
};

describe('parseContextResultChunk', () => {
  it('parses a valid data chunk into the domain shape', () => {
    const chunk = parseContextResultChunk(validDataChunkWire);
    expect(chunk).toEqual({
      schemaVersion: 1,
      jobId: 'job-1',
      userId: 'user-1',
      sequence: 0,
      type: 'data',
      data: { provider: 'trello', content: '{}', tokenEstimate: 10 },
    });
  });

  it('parses a valid terminal status chunk', () => {
    const chunk = parseContextResultChunk({
      schema_version: 1,
      job_id: 'job-1',
      user_id: 'user-1',
      sequence: 1,
      type: 'status',
      status: { phase: 'completed' },
    });
    expect(chunk).toEqual({
      schemaVersion: 1,
      jobId: 'job-1',
      userId: 'user-1',
      sequence: 1,
      type: 'status',
      status: { phase: 'completed' },
    });
  });

  it.each([
    ['not an object', 'a string'],
    ['wrong schema_version', { ...validDataChunkWire, schema_version: 2 }],
    ['missing job_id', { ...validDataChunkWire, job_id: undefined }],
    ['non-integer sequence', { ...validDataChunkWire, sequence: 1.5 }],
    ['negative sequence', { ...validDataChunkWire, sequence: -1 }],
    [
      'unknown provider',
      {
        ...validDataChunkWire,
        data: { ...validDataChunkWire.data, provider: 'slack' },
      },
    ],
    ['unknown type', { ...validDataChunkWire, type: 'bogus' }],
    [
      'unknown status phase',
      {
        schema_version: 1,
        job_id: 'job-1',
        user_id: 'user-1',
        sequence: 0,
        type: 'status',
        status: { phase: 'bogus' },
      },
    ],
  ])('returns null for %s', (_label, input) => {
    expect(parseContextResultChunk(input)).toBeNull();
  });
});

describe('ContextResultsConsumer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('nacks (no requeue) a malformed (non-JSON) message', async () => {
    const channel = makeChannel();
    const execute = jest.fn();
    const handleChunk = {
      execute,
    } as unknown as HandleContextResultChunkUseCase;
    const consumer = new ContextResultsConsumer(
      makeConnectionProvider(channel),
      handleChunk,
      new EventEmitter2(),
    );

    const msg = makeMsg('not-json{{{', true);
    await (consumer as any).onMessage(msg);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('nacks (no requeue) a structurally invalid chunk', async () => {
    const channel = makeChannel();
    const execute = jest.fn();
    const handleChunk = {
      execute,
    } as unknown as HandleContextResultChunkUseCase;
    const consumer = new ContextResultsConsumer(
      makeConnectionProvider(channel),
      handleChunk,
      new EventEmitter2(),
    );

    const msg = makeMsg({ schema_version: 2 });
    await (consumer as any).onMessage(msg);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('nacks (no requeue) on unknown-job / ownership-mismatch outcomes', async () => {
    const channel = makeChannel();
    const execute = jest.fn().mockResolvedValue({
      outcome: 'unknown-job',
      job: null,
      terminal: false,
    });
    const handleChunk = {
      execute,
    } as unknown as HandleContextResultChunkUseCase;
    const consumer = new ContextResultsConsumer(
      makeConnectionProvider(channel),
      handleChunk,
      new EventEmitter2(),
    );

    const msg = makeMsg(validDataChunkWire);
    await (consumer as any).onMessage(msg);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('acks a duplicate outcome without relaying anything', async () => {
    const channel = makeChannel();
    const emitSpy = jest.fn();
    const eventEmitter = { emit: emitSpy } as unknown as EventEmitter2;
    const execute = jest.fn().mockResolvedValue({
      outcome: 'duplicate',
      job: makeJob(),
      terminal: false,
    });
    const handleChunk = {
      execute,
    } as unknown as HandleContextResultChunkUseCase;
    const consumer = new ContextResultsConsumer(
      makeConnectionProvider(channel),
      handleChunk,
      eventEmitter,
    );

    const msg = makeMsg(validDataChunkWire);
    await (consumer as any).onMessage(msg);

    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('acks and relays planning.chunk for an applied, non-terminal data chunk', async () => {
    const channel = makeChannel();
    const emitSpy = jest.fn();
    const eventEmitter = { emit: emitSpy } as unknown as EventEmitter2;
    const execute = jest.fn().mockResolvedValue({
      outcome: 'applied',
      job: makeJob(),
      terminal: false,
    });
    const handleChunk = {
      execute,
    } as unknown as HandleContextResultChunkUseCase;
    const consumer = new ContextResultsConsumer(
      makeConnectionProvider(channel),
      handleChunk,
      eventEmitter,
    );

    const msg = makeMsg(validDataChunkWire);
    await (consumer as any).onMessage(msg);

    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(emitSpy).toHaveBeenCalledWith('planning.chunk', {
      jobId: 'job-1',
      userId: 'user-1',
      sequence: 0,
      type: 'data',
      data: { provider: 'trello', content: '{}', tokenEstimate: 10 },
      status: undefined,
    });
  });

  it('relays planning.status(planning) then planning.completed for a terminal, applied completed chunk', async () => {
    const channel = makeChannel();
    const emitSpy = jest.fn();
    const eventEmitter = { emit: emitSpy } as unknown as EventEmitter2;
    const completedJob = makeJob({
      status: JobStatus.Completed,
      result: { suggestions: ['x'] },
    });
    const execute = jest.fn().mockResolvedValue({
      outcome: 'applied',
      job: completedJob,
      terminal: true,
    });
    const handleChunk = {
      execute,
    } as unknown as HandleContextResultChunkUseCase;
    const consumer = new ContextResultsConsumer(
      makeConnectionProvider(channel),
      handleChunk,
      eventEmitter,
    );

    const msg = makeMsg({
      schema_version: 1,
      job_id: 'job-1',
      user_id: 'user-1',
      sequence: 2,
      type: 'status',
      status: { phase: 'completed' },
    });
    await (consumer as any).onMessage(msg);

    // Full sequence, not just an Nth-call spot check — the completed path
    // is the ONLY terminal path that passes through `planning.status`
    // (Planning) before its terminal event.
    expect(emitSpy).toHaveBeenCalledTimes(2);
    expect(emitSpy).toHaveBeenNthCalledWith(1, 'planning.status', {
      jobId: 'job-1',
      userId: 'user-1',
      status: JobStatus.Planning,
    });
    expect(emitSpy).toHaveBeenNthCalledWith(2, 'planning.completed', {
      jobId: 'job-1',
      userId: 'user-1',
      status: JobStatus.Completed,
      result: { suggestions: ['x'] },
    });
    expect(channel.ack).toHaveBeenCalledWith(msg);
    // A terminal, applied COMPLETED chunk is not a failure — no report.
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('relays planning.failed for a terminal, applied failed chunk', async () => {
    const channel = makeChannel();
    const emitSpy = jest.fn();
    const eventEmitter = { emit: emitSpy } as unknown as EventEmitter2;
    const failedJob = makeJob({
      status: JobStatus.Failed,
      errorCode: 'MCP_UNAVAILABLE',
      errorMessage: 'nope',
    });
    const execute = jest.fn().mockResolvedValue({
      outcome: 'applied',
      job: failedJob,
      terminal: true,
    });
    const handleChunk = {
      execute,
    } as unknown as HandleContextResultChunkUseCase;
    const consumer = new ContextResultsConsumer(
      makeConnectionProvider(channel),
      handleChunk,
      eventEmitter,
    );

    const msg = makeMsg({
      schema_version: 1,
      job_id: 'job-1',
      user_id: 'user-1',
      sequence: 2,
      type: 'status',
      status: { phase: 'failed', error_code: 'MCP_UNAVAILABLE' },
    });
    await (consumer as any).onMessage(msg);

    // Full sequence: a terminal `failed` chunk must emit ONLY
    // `planning.failed` — never a fabricated intermediate
    // `planning.status`(Planning), since the job never actually entered
    // `planning` on this path.
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenNthCalledWith(1, 'planning.failed', {
      jobId: 'job-1',
      userId: 'user-1',
      status: JobStatus.Failed,
      errorCode: 'MCP_UNAVAILABLE',
      errorMessage: 'nope',
    });
    // `terminal: true` + a Failed job means THIS call won the finalize CAS —
    // report exactly once.
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('does NOT report to Sentry for a losing CAS racer (terminal: false, job already Failed)', async () => {
    const channel = makeChannel();
    const emitSpy = jest.fn();
    const eventEmitter = { emit: emitSpy } as unknown as EventEmitter2;
    // A losing racer — e.g. a gather-timeout won the CAS first — comes back
    // as a `duplicate` outcome with `terminal: false`, even though the job
    // itself is already `Failed`. This must not double-report.
    const execute = jest.fn().mockResolvedValue({
      outcome: 'duplicate',
      job: makeJob({
        status: JobStatus.Failed,
        errorCode: 'CONTEXT_ENGINE_TIMEOUT',
        errorMessage: 'timed out',
      }),
      terminal: false,
    });
    const handleChunk = {
      execute,
    } as unknown as HandleContextResultChunkUseCase;
    const consumer = new ContextResultsConsumer(
      makeConnectionProvider(channel),
      handleChunk,
      eventEmitter,
    );

    const msg = makeMsg({
      schema_version: 1,
      job_id: 'job-1',
      user_id: 'user-1',
      sequence: 3,
      type: 'status',
      status: { phase: 'failed' },
    });
    await (consumer as any).onMessage(msg);

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('requeues (nack requeue=true) on a transient use-case failure', async () => {
    const channel = makeChannel();
    const execute = jest.fn().mockRejectedValue(new Error('mongo hiccup'));
    const handleChunk = {
      execute,
    } as unknown as HandleContextResultChunkUseCase;
    const consumer = new ContextResultsConsumer(
      makeConnectionProvider(channel),
      handleChunk,
      new EventEmitter2(),
    );

    const msg = makeMsg(validDataChunkWire);
    await (consumer as any).onMessage(msg);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('is a no-op for a null message (consumer cancellation)', async () => {
    const channel = makeChannel();
    const handleChunk = {
      execute: jest.fn(),
    } as unknown as HandleContextResultChunkUseCase;
    const consumer = new ContextResultsConsumer(
      makeConnectionProvider(channel),
      handleChunk,
      new EventEmitter2(),
    );

    await (consumer as any).onMessage(null);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });

  describe('per-job serialization', () => {
    function deferred() {
      let resolve!: (v: unknown) => void;
      const promise = new Promise((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }
    const flush = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    const terminalWire = (jobId: string, sequence: number) => ({
      schema_version: 1,
      job_id: jobId,
      user_id: 'user-1',
      sequence,
      type: 'status',
      status: { phase: 'completed' },
    });
    const dataWire = (jobId: string, sequence: number) => ({
      ...validDataChunkWire,
      job_id: jobId,
      sequence,
    });
    const okResult = {
      outcome: 'applied',
      job: makeJob(),
      terminal: false,
    };

    function build(execute: jest.Mock) {
      const channel = makeChannel();
      const consumer = new ContextResultsConsumer(
        makeConnectionProvider(channel),
        { execute } as unknown as HandleContextResultChunkUseCase,
        new EventEmitter2(),
      );
      return { channel, consumer };
    }

    it('does not handle the terminal chunk until an in-flight data chunk of the same job completes', async () => {
      const slow = deferred();
      const execute = jest
        .fn()
        .mockImplementationOnce(() => slow.promise)
        .mockResolvedValue(okResult);
      const { consumer, channel } = build(execute);

      const dataMsg = makeMsg(dataWire('job-1', 0));
      const terminalMsg = makeMsg(terminalWire('job-1', 1));
      const p1 = (consumer as any).onMessage(dataMsg);
      const p2 = (consumer as any).onMessage(terminalMsg);
      await flush();

      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0][0].chunk.sequence).toBe(0);

      slow.resolve(okResult);
      await Promise.all([p1, p2]);

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[1][0].chunk.sequence).toBe(1);
      expect(channel.ack).toHaveBeenCalledWith(dataMsg);
      expect(channel.ack).toHaveBeenCalledWith(terminalMsg);
    });

    it('does not block chunks of a different job', async () => {
      const slow = deferred();
      const execute = jest
        .fn()
        .mockImplementationOnce(() => slow.promise)
        .mockResolvedValue(okResult);
      const { consumer } = build(execute);

      const p1 = (consumer as any).onMessage(makeMsg(dataWire('job-1', 0)));
      const p2 = (consumer as any).onMessage(makeMsg(dataWire('job-2', 0)));
      await flush();

      expect(execute).toHaveBeenCalledTimes(2);
      slow.resolve(okResult);
      await Promise.all([p1, p2]);
    });

    it('keeps processing later messages of a job after one fails, and acks/nacks each as before', async () => {
      const execute = jest
        .fn()
        .mockRejectedValueOnce(new Error('mongo hiccup'))
        .mockResolvedValue(okResult);
      const { consumer, channel } = build(execute);

      const m1 = makeMsg(dataWire('job-1', 0));
      const m2 = makeMsg(dataWire('job-1', 1));
      await Promise.all([
        (consumer as any).onMessage(m1),
        (consumer as any).onMessage(m2),
      ]);

      expect(channel.nack).toHaveBeenCalledWith(m1, false, true);
      expect(channel.ack).toHaveBeenCalledWith(m2);
    });

    it('removes the chain entry once a job drains', async () => {
      const execute = jest.fn().mockResolvedValue(okResult);
      const { consumer } = build(execute);

      await Promise.all([
        (consumer as any).onMessage(makeMsg(dataWire('job-1', 0))),
        (consumer as any).onMessage(makeMsg(dataWire('job-1', 1))),
        (consumer as any).onMessage(makeMsg(dataWire('job-2', 0))),
      ]);
      await flush();

      expect((consumer as any).jobChains.size).toBe(0);
    });

    it('nacks a malformed message immediately even while its neighbours are in flight', async () => {
      const slow = deferred();
      const execute = jest.fn().mockImplementation(() => slow.promise);
      const { consumer, channel } = build(execute);

      const p1 = (consumer as any).onMessage(makeMsg(dataWire('job-1', 0)));
      const bad = makeMsg('not-json{{{', true);
      await (consumer as any).onMessage(bad);

      expect(channel.nack).toHaveBeenCalledWith(bad, false, false);
      slow.resolve(okResult);
      await p1;
    });
  });

  describe('onModuleInit', () => {
    it('does not wait for the broker and registers the consumer', async () => {
      const channel = makeChannel();
      channel.waitForConnect.mockReturnValue(new Promise(() => undefined));
      const consumer = new ContextResultsConsumer(
        makeConnectionProvider(channel),
        { execute: jest.fn() } as unknown as HandleContextResultChunkUseCase,
        new EventEmitter2(),
      );

      await consumer.onModuleInit();

      expect(channel.waitForConnect).not.toHaveBeenCalled();
      expect(channel.consume).toHaveBeenCalledWith(
        'ctx.gather.results',
        expect.any(Function),
        { prefetch: 20 },
      );
    });

    it('does not reject when consume() fails', async () => {
      const channel = makeChannel();
      channel.consume.mockRejectedValue(new Error('boom'));
      const consumer = new ContextResultsConsumer(
        makeConnectionProvider(channel),
        { execute: jest.fn() } as unknown as HandleContextResultChunkUseCase,
        new EventEmitter2(),
      );

      const logSpy = jest
        .spyOn((consumer as any).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(consumer.onModuleInit()).resolves.toBeUndefined();
      await new Promise((r) => setImmediate(r));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
  });
});
