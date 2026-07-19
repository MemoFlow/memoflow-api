import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../../application/auth/jwt-payload.interface';
import { GetPlanningJobUseCase } from '../../application/context/get-planning-job.use-case';
import { GetUserByIdUseCase } from '../../application/users/get-user-by-id.use-case';
import { JobStatus, PlanningJob } from '../../domain/context/planning-job';

interface PlanningStatusEvent {
  jobId: string;
  userId: string;
  // `Running` — the legacy synchronous HTTP/stub path (`PlanningProcessor`).
  // `Gathering`/`Planning` — the RabbitMQ context-engine transport
  // (`docs/contracts/context-engine.md` §4): `Gathering` once the request
  // publishes, `Planning` once the terminal `completed` chunk arrives and
  // the LLM planner starts.
  status: JobStatus.Running | JobStatus.Gathering | JobStatus.Planning;
}

interface PlanningCompletedEvent {
  jobId: string;
  userId: string;
  status: JobStatus.Completed;
  result: Record<string, unknown> | null;
}

interface PlanningFailedEvent {
  jobId: string;
  userId: string;
  status: JobStatus.Failed;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * One `ctx.gather.results` chunk relayed live, as the RabbitMQ context-
 * engine transport's `ContextResultsConsumer` receives it — this is what
 * lets the frontend stream gathered context without polling
 * (`docs/contracts/context-engine.md` §3). Only emitted for non-terminal
 * chunks; the terminal `completed`/`failed` status chunk is instead relayed
 * as the richer `planning.completed`/`planning.failed` event above.
 */
interface PlanningChunkEvent {
  jobId: string;
  userId: string;
  sequence: number;
  type: 'data' | 'status';
  data?: { provider: string; content: string; tokenEstimate?: number };
  status?: { phase: string; message?: string; errorCode?: string };
}

interface SubscribeMessagePayload {
  jobId: unknown;
}

/**
 * WebSocket gateway pushing planning-job results to the frontend in
 * real time. Transport edge only — mirrors a controller: calls use-cases
 * only, never repositories.
 *
 * CORS origin is read directly from `process.env` here (not `ConfigService`)
 * because decorator arguments evaluate at import time, before Nest has
 * built the DI container `ConfigService` lives in — there is no `ConfigService`
 * instance yet for this read to go through. `env.validation.ts` does validate
 * `WS_CORS_ORIGIN` as part of the app's overall boot sequence, but that
 * validation runs later (when `ConfigModule` initializes) and is not a
 * guarantee for this specific `process.env` read; if the decorator evaluates
 * before validation would have rejected a bad value, this falls back to `'*'`
 * rather than failing fast.
 */
@WebSocketGateway({
  cors: { origin: process.env.WS_CORS_ORIGIN ?? '*' },
})
export class PlanningGateway implements OnGatewayConnection {
  private readonly logger = new Logger(PlanningGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly getUserById: GetUserByIdUseCase,
    private readonly getPlanningJob: GetPlanningJobUseCase,
  ) {}

  /**
   * Handshake auth: browsers can't set WS headers, so the token travels in
   * `handshake.auth.token` rather than an Authorization header. Verified the
   * same way `JwtStrategy` verifies REST requests (same secret, same
   * payload shape, same "user must still exist" check) — any failure
   * disconnects the socket without further detail.
   */
  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
      // Mirrors JwtStrategy: a missing user means the token no longer maps
      // to an account (deleted user, forged sub) — treat it as an auth
      // failure, same as an invalid/expired token.
      await this.getUserById.execute(payload.sub);

      client.data.userId = payload.sub;
      // Room is server-derived from the verified token — never from
      // anything the client supplies — so a socket can only ever be joined
      // to its own owner room.
      await client.join(`user:${payload.sub}`);
      // Deterministic readiness signal: the client-visible `connect` event
      // fires before this async handshake (verify + room join) completes,
      // so callers that need the join to be in effect (e.g. before
      // submitting a job they expect to be pushed back to this socket)
      // should wait for `ready` instead of an arbitrary delay.
      client.emit('ready');
    } catch {
      // Swallow the error (invalid signature, expired token, missing user,
      // malformed payload) — all of these are indistinguishable auth
      // failures from the client's point of view.
      client.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeMessagePayload,
  ): Promise<void> {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      return;
    }

    const jobId = body?.jobId;
    if (typeof jobId !== 'string' || jobId.length === 0) {
      return;
    }

    try {
      const job = await this.getPlanningJob.execute({ jobId, userId });
      const { event, payload } = this.toClientEvent(job);
      client.emit(event, payload);
    } catch (err) {
      if (err instanceof NotFoundException) {
        // Missing job and someone else's job both look the same to the
        // client — never leak existence of another user's job.
        client.emit('planning.error', { jobId, message: 'not found' });
        return;
      }
      const errorMessage = err instanceof Error ? err.message : 'unknown';
      this.logger.error(
        `Unexpected failure handling subscribe for job ${jobId}: ${errorMessage}`,
      );
      throw err;
    }
  }

  @OnEvent('planning.status')
  handlePlanningStatus(payload: PlanningStatusEvent): void {
    const { userId, ...clientPayload } = payload;
    this.server.to(`user:${userId}`).emit('planning.status', clientPayload);
  }

  @OnEvent('planning.completed')
  handlePlanningCompleted(payload: PlanningCompletedEvent): void {
    const { userId, ...clientPayload } = payload;
    this.server.to(`user:${userId}`).emit('planning.completed', clientPayload);
  }

  @OnEvent('planning.failed')
  handlePlanningFailed(payload: PlanningFailedEvent): void {
    const { userId, ...clientPayload } = payload;
    this.server.to(`user:${userId}`).emit('planning.failed', clientPayload);
  }

  @OnEvent('planning.chunk')
  handlePlanningChunk(payload: PlanningChunkEvent): void {
    const { userId, ...clientPayload } = payload;
    this.server.to(`user:${userId}`).emit('planning.chunk', clientPayload);
  }

  /**
   * Maps a job's current state to the same (event name, payload) shape used
   * by the live `@OnEvent` relays, so catch-up and live delivery are
   * indistinguishable to the client.
   */
  private toClientEvent(job: PlanningJob): {
    event: string;
    payload: Record<string, unknown>;
  } {
    if (job.status === JobStatus.Completed) {
      return {
        event: 'planning.completed',
        payload: {
          jobId: job.id,
          status: job.status,
          result: job.result,
        },
      };
    }
    if (job.status === JobStatus.Failed) {
      return {
        event: 'planning.failed',
        payload: {
          jobId: job.id,
          status: job.status,
          errorCode: job.errorCode,
          errorMessage: job.errorMessage,
        },
      };
    }
    // pending / running / gathering / planning all catch up as
    // `planning.status`.
    return {
      event: 'planning.status',
      payload: { jobId: job.id, status: job.status },
    };
  }
}
