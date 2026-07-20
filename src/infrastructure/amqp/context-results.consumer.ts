import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { ConsumeMessage } from 'amqplib';
import { HandleContextResultChunkUseCase } from '../../application/context/handle-context-result-chunk.use-case';
import {
  ChunkPhase,
  ContextResultChunk,
} from '../../domain/context/context-result-chunk';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';
import {
  assertContextTopology,
  CTX_GATHER_RESULTS_QUEUE,
} from './context-topology';
import { RabbitMqConnectionProvider } from './rabbitmq-connection.provider';

const ALLOWED_PROVIDERS = new Set(['trello', 'notion', 'github']);
const ALLOWED_PHASES = new Set<ChunkPhase>([
  'started',
  'gathering',
  'completed',
  'failed',
]);

/** See the transient-failure catch in `onMessage` — a lightweight spacer
 * before requeueing, not a real backoff policy. */
const TRANSIENT_REQUEUE_DELAY_MS = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Basic structural validation of one raw `ctx.gather.results` JSON body
 * against `docs/contracts/context-result.schema.json` — deliberately hand-
 * rolled (no JSON-schema library) per the implementation brief. Returns
 * `null` for anything that doesn't match, which the consumer treats as
 * unrecoverable (nack, no requeue -> DLQ).
 */
export function parseContextResultChunk(
  raw: unknown,
): ContextResultChunk | null {
  if (!isRecord(raw)) return null;
  const { schema_version, job_id, user_id, sequence, type } = raw;

  if (schema_version !== 1) return null;
  if (typeof job_id !== 'string' || job_id.length === 0) return null;
  if (typeof user_id !== 'string' || user_id.length === 0) return null;
  if (
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 0
  ) {
    return null;
  }

  if (type === 'data') {
    const data = raw.data;
    if (!isRecord(data)) return null;
    const { provider, content, token_estimate } = data;
    if (typeof provider !== 'string' || !ALLOWED_PROVIDERS.has(provider)) {
      return null;
    }
    if (typeof content !== 'string') return null;
    if (token_estimate !== undefined && typeof token_estimate !== 'number') {
      return null;
    }
    return {
      schemaVersion: 1,
      jobId: job_id,
      userId: user_id,
      sequence,
      type: 'data',
      data: {
        provider,
        content,
        ...(token_estimate !== undefined
          ? { tokenEstimate: token_estimate }
          : {}),
      },
    };
  }

  if (type === 'status') {
    const status = raw.status;
    if (!isRecord(status)) return null;
    const { phase, message, error_code } = status;
    if (typeof phase !== 'string' || !ALLOWED_PHASES.has(phase as ChunkPhase)) {
      return null;
    }
    if (message !== undefined && typeof message !== 'string') return null;
    if (error_code !== undefined && typeof error_code !== 'string') return null;
    return {
      schemaVersion: 1,
      jobId: job_id,
      userId: user_id,
      sequence,
      type: 'status',
      status: {
        phase: phase as ChunkPhase,
        ...(message !== undefined ? { message } : {}),
        ...(error_code !== undefined ? { errorCode: error_code } : {}),
      },
    };
  }

  return null;
}

/**
 * Consumes `ctx.gather.results` (`docs/contracts/context-engine.md` §1, §3):
 * parses + structurally validates each chunk, delegates to
 * `HandleContextResultChunkUseCase`, then acks/nacks and relays the outcome
 * over the existing planning WebSocket gateway's `EventEmitter2` events —
 * this consumer is the ONLY place in the queue-transport path that emits
 * `planning.*` events, mirroring `PlanningProcessor`'s role for the legacy
 * BullMQ path. Only bound by `ContextModule` when `RABBITMQ_URL` is
 * configured.
 */
@Injectable()
export class ContextResultsConsumer implements OnModuleInit {
  private readonly logger = new Logger(ContextResultsConsumer.name);
  private readonly channelWrapper: ChannelWrapper;

  constructor(
    connectionProvider: RabbitMqConnectionProvider,
    private readonly handleChunk: HandleContextResultChunkUseCase,
    private readonly eventEmitter: EventEmitter2,
  ) {
    const connection = connectionProvider.getConnection();
    this.channelWrapper = connection.createChannel({
      name: 'ctx-gather-results-consumer',
      json: false,
      setup: (channel) => assertContextTopology(channel),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.channelWrapper.waitForConnect();
    await this.channelWrapper.consume(
      CTX_GATHER_RESULTS_QUEUE,
      (msg) => {
        void this.onMessage(msg);
      },
      { prefetch: 20 },
    );
    this.logger.log('RabbitMQ context-results consumer ready');
  }

  private async onMessage(msg: ConsumeMessage | null): Promise<void> {
    // A null message means the consumer was cancelled server-side (e.g. the
    // queue was deleted) — nothing to ack/nack.
    if (!msg) return;

    let raw: unknown;
    try {
      raw = JSON.parse(msg.content.toString('utf-8'));
    } catch {
      this.logger.warn('Nacking malformed (non-JSON) context result chunk');
      this.channelWrapper.nack(msg, false, false);
      return;
    }

    const chunk = parseContextResultChunk(raw);
    if (!chunk) {
      this.logger.warn(
        'Nacking structurally invalid context result chunk (schema mismatch)',
      );
      this.channelWrapper.nack(msg, false, false);
      return;
    }

    try {
      const result = await this.handleChunk.execute({ chunk });

      // Async surface: a terminal `failed` write here never rethrows (the
      // use-case returns normally) and never reaches HttpExceptionFilter,
      // and this plain amqplib consumer has no @Processor/BullMQ-style
      // auto-instrumentation — so report it explicitly, exactly once.
      // `result.terminal` is `true` only for the call that actually WON the
      // finalize CAS (`claimForPlanning`/`failIfStillGathering` in
      // `HandleContextResultChunkUseCase`); a losing racer (e.g. a
      // gather-timeout racing a slow failure chunk) gets `terminal: false`
      // and is correctly skipped here.
      if (result.terminal && result.job?.status === JobStatus.Failed) {
        Sentry.captureException(
          new Error(result.job.errorMessage ?? 'Context result chunk failed'),
          {
            extra: { jobId: result.job.id, errorCode: result.job.errorCode },
          },
        );
      }

      if (
        result.outcome === 'unknown-job' ||
        result.outcome === 'ownership-mismatch'
      ) {
        this.logger.warn(
          `Nacking context result chunk for job ${chunk.jobId} (sequence ` +
            `${chunk.sequence}): ${result.outcome}`,
        );
        this.channelWrapper.nack(msg, false, false);
        return;
      }

      if (result.outcome === 'applied') {
        this.relay(result.job, chunk, result.terminal);
      }
      this.channelWrapper.ack(msg);
    } catch (err) {
      // Transient failure (e.g. a Mongo hiccup) — requeue rather than DLQ
      // so a retry can succeed once the dependency recovers. A short delay
      // before the nack keeps a sustained outage from hot-looping this
      // consumer (redeliver -> fail -> redeliver...) — this is a cheap
      // backstop, not a real backoff policy (there's no per-message retry
      // count here, unlike BullMQ); it just spaces requeues out a bit.
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Transient failure handling context result chunk for job ` +
          `${chunk.jobId} (sequence ${chunk.sequence}), requeueing: ${errorMessage}`,
      );
      await this.delay(TRANSIENT_REQUEUE_DELAY_MS);
      this.channelWrapper.nack(msg, false, true);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private relay(
    job: PlanningJob | null,
    chunk: ContextResultChunk,
    terminal: boolean,
  ): void {
    if (!job) return;

    if (!terminal) {
      this.eventEmitter.emit('planning.chunk', {
        jobId: chunk.jobId,
        userId: chunk.userId,
        sequence: chunk.sequence,
        type: chunk.type,
        data: chunk.type === 'data' ? chunk.data : undefined,
        status: chunk.type === 'status' ? chunk.status : undefined,
      });
      return;
    }

    // Terminal — mirrors PlanningProcessor's "intermediate status, then
    // terminal event" shape, but ONLY the completed path actually passed
    // through `planning` (HandleContextResultChunkUseCase's
    // claimForPlanning CAS runs exclusively on `phase === 'completed'`). A
    // terminal `failed` chunk never entered `planning` — emitting that
    // status here would fabricate a transition the job never made and the
    // client never experienced before `planning.failed`.
    if (chunk.type === 'status' && chunk.status.phase === 'completed') {
      this.eventEmitter.emit('planning.status', {
        jobId: job.id,
        userId: job.userId,
        status: JobStatus.Planning,
      });
    }

    if (job.status === JobStatus.Completed) {
      this.eventEmitter.emit('planning.completed', {
        jobId: job.id,
        userId: job.userId,
        status: job.status,
        result: job.result,
      });
    } else if (job.status === JobStatus.Failed) {
      this.eventEmitter.emit('planning.failed', {
        jobId: job.id,
        userId: job.userId,
        status: job.status,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
      });
    }
  }
}
