import { EventEmitter2 } from '@nestjs/event-emitter';
import { HandleContextResultChunkUseCase } from '../../application/context/handle-context-result-chunk.use-case';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  ContextResultsConsumer,
  parseContextResultChunk,
} from './context-results.consumer';
import { RabbitMqConnectionProvider } from './rabbitmq-connection.provider';

function makeChannel() {
  return {
    waitForConnect: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(undefined),
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
});
