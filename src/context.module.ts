import { getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import type { Queue } from 'bullmq';
import { GetPlanningJobUseCase } from './application/context/get-planning-job.use-case';
import { GATHER_TIMEOUT_MS } from './application/context/gather-timeout-ms.token';
import { HandleContextResultChunkUseCase } from './application/context/handle-context-result-chunk.use-case';
import { HandleGatherTimeoutUseCase } from './application/context/handle-gather-timeout.use-case';
import { ProcessPlanningJobUseCase } from './application/context/process-planning-job.use-case';
import { SubmitPlanningJobUseCase } from './application/context/submit-planning-job.use-case';
import { AiModule } from './ai.module';
import { ConnectorsModule } from './connectors.module';
import { DocumentsModule } from './documents.module';
import {
  CONTEXT_ENGINE,
  ContextEnginePort,
} from './domain/context/context-engine.port';
import {
  CONTEXT_GATHERER,
  ContextGatherer,
} from './domain/context/context-gatherer.port';
import {
  CONTEXT_REQUEST_PUBLISHER,
  ContextRequestPublisher,
} from './domain/context/context-request-publisher.port';
import {
  GATHER_TIMEOUT_SCHEDULER,
  GatherTimeoutScheduler,
} from './domain/context/gather-timeout-scheduler.port';
import { LLM_PLANNER, LlmPlanner } from './domain/context/llm-planner.port';
import { PLANNING_JOB_REPOSITORY } from './domain/context/planning-job.repository';
import { AnthropicLlmPlanner } from './infrastructure/context/anthropic-llm-planner';
import { ConnectorContextGatherer } from './infrastructure/context/connector-context-gatherer';
import { ContextEngineHttpClient } from './infrastructure/context/context-engine.http-client';
import { StubContextGatherer } from './infrastructure/context/stub-context-gatherer';
import { StubLlmPlanner } from './infrastructure/context/stub-llm-planner';
import { AnthropicClientProvider } from './infrastructure/ai/anthropic.client';
import { ContextResultsConsumer } from './infrastructure/amqp/context-results.consumer';
import { RabbitContextRequestPublisher } from './infrastructure/amqp/rabbit-context-request.publisher';
import { RabbitMqConnectionProvider } from './infrastructure/amqp/rabbitmq-connection.provider';
import { PlanningJobMongooseRepository } from './infrastructure/persistence/context/planning-job.mongoose.repository';
import {
  PlanningJobOdmEntity,
  PlanningJobSchema,
} from './infrastructure/persistence/context/planning-job.schema';
import { BullMqGatherTimeoutScheduler } from './infrastructure/queue/context/bullmq-gather-timeout.scheduler';
import { GatherTimeoutProcessor } from './infrastructure/queue/context/gather-timeout.processor';
import { GATHER_TIMEOUT_QUEUE_NAME } from './infrastructure/queue/context/bullmq-gather-timeout.scheduler';
import { PlanningProcessor } from './infrastructure/queue/context/planning.processor';
import { QueueModule } from './infrastructure/queue/context/queue.module';
import { PlanningJobsController } from './presentation/context/planning-jobs.controller';
import { PlanningGateway } from './presentation/context/planning.gateway';
import { UsersModule } from './users.module';

/** Default `CONTEXT_GATHER_TIMEOUT_MS` — mirrors
 * `docs/contracts/context-engine.md` §4 and `env.validation.ts`'s default. */
const DEFAULT_GATHER_TIMEOUT_MS = 120_000;

/**
 * Picks the real, Composio-backed gatherer (`ConnectorContextGatherer` ->
 * `ContextEngineHttpClient`) once `CONTEXT_ENGINE_URL` is configured, and
 * falls back to `StubContextGatherer` otherwise — so `start:dev` / smoke /
 * e2e keep working with no context engine configured. Exported (rather than
 * inlined in `providers`) so it has a direct unit test.
 */
export function contextGathererFactory(
  config: ConfigService,
  engine: ContextEnginePort,
): ContextGatherer {
  return config.get<string>('CONTEXT_ENGINE_URL')
    ? new ConnectorContextGatherer(engine)
    : new StubContextGatherer();
}

/**
 * Roadmap item 5 (AI layer) — picks the real, Anthropic-backed planner once
 * `ANTHROPIC_API_KEY` is configured, and falls back to `StubLlmPlanner`
 * otherwise (echoes the prompt back), mirroring `contextGathererFactory`
 * above. Exported for a direct unit test.
 */
export function llmPlannerFactory(
  config: ConfigService,
  clientProvider: AnthropicClientProvider,
): LlmPlanner {
  return config.get<string>('ANTHROPIC_API_KEY')
    ? new AnthropicLlmPlanner(clientProvider)
    : new StubLlmPlanner();
}

/** Resolves `CONTEXT_GATHER_TIMEOUT_MS`, defaulting like every other
 * optional numeric env var in this codebase. Exported for a direct unit
 * test. */
export function gatherTimeoutMsFactory(config: ConfigService): number {
  return (
    config.get<number>('CONTEXT_GATHER_TIMEOUT_MS') ?? DEFAULT_GATHER_TIMEOUT_MS
  );
}

/**
 * RabbitMQ context-engine transport (`docs/contracts/context-engine.md`):
 * binds `CONTEXT_REQUEST_PUBLISHER` only when `RABBITMQ_URL` is configured
 * — mirrors `contextGathererFactory`'s `CONTEXT_ENGINE_URL` conditional.
 * `ProcessPlanningJobUseCase` injects this `@Optional()`; its absence keeps
 * the legacy synchronous HTTP/stub gather path completely unchanged.
 * Exported for a direct unit test.
 */
export function contextRequestPublisherFactory(
  config: ConfigService,
  connectionProvider: RabbitMqConnectionProvider,
): ContextRequestPublisher | undefined {
  return config.get<string>('RABBITMQ_URL')
    ? new RabbitContextRequestPublisher(connectionProvider)
    : undefined;
}

/** Same conditional as `contextRequestPublisherFactory` — the no-result
 * timeout only ever needs scheduling on the queue-transport path. Exported
 * for a direct unit test. */
export function gatherTimeoutSchedulerFactory(
  config: ConfigService,
  queue: Queue,
): GatherTimeoutScheduler | undefined {
  return config.get<string>('RABBITMQ_URL')
    ? new BullMqGatherTimeoutScheduler(queue)
    : undefined;
}

/** Same conditional — the results consumer has nothing to consume (and
 * `RabbitMqConnectionProvider.getConnection()` would throw on the missing
 * `RABBITMQ_URL`) unless the transport is enabled. Exported for a direct
 * unit test. */
export function contextResultsConsumerFactory(
  config: ConfigService,
  connectionProvider: RabbitMqConnectionProvider,
  handleChunk: HandleContextResultChunkUseCase,
  eventEmitter: EventEmitter2,
): ContextResultsConsumer | undefined {
  return config.get<string>('RABBITMQ_URL')
    ? new ContextResultsConsumer(connectionProvider, handleChunk, eventEmitter)
    : undefined;
}

/**
 * Branch: feature/connector-context-engine (roadmap item 7, branch 3) — wires
 * `contextGathererFactory` above as the `CONTEXT_GATHERER` provider. Imports
 * `AiModule` to reuse its exported `AnthropicClientProvider` for
 * `llmPlannerFactory` (roadmap item 5) — a single shared Anthropic client
 * rather than a second instance — and `DocumentsModule` so
 * `SubmitPlanningJobUseCase` can validate an optional `documentId`/
 * `sectionId` binding against `DOCUMENT_REPOSITORY`/`SECTION_REPOSITORY`
 * before writing it into Mongo (also roadmap item 5).
 *
 * Branch: feature/rabbitmq-transport — wires the RabbitMQ context-engine
 * transport (`docs/contracts/context-engine.md`) alongside the above: the
 * `CONTEXT_REQUEST_PUBLISHER`/`GATHER_TIMEOUT_SCHEDULER`/
 * `ContextResultsConsumer` providers are all `RABBITMQ_URL`-gated
 * `useFactory`s (never bare `useClass`) specifically so their classes are
 * never constructed — and therefore never touch `RabbitMqConnectionProvider
 * .getConnection()`'s `RABBITMQ_URL` read — when the var is unset. This is
 * what makes `RABBITMQ_URL` genuinely optional for boot, the same
 * conditional-provider pattern `contextGathererFactory` already established
 * for `CONTEXT_ENGINE_URL`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlanningJobOdmEntity.name, schema: PlanningJobSchema },
    ]),
    QueueModule,
    UsersModule,
    ConnectorsModule,
    AiModule,
    DocumentsModule,
    // The gateway verifies WS handshake JWTs itself (mirrors JwtStrategy),
    // so it needs its own JwtService — UsersModule configures JwtModule but
    // doesn't export it, so it's registered here too, from the same secret.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [PlanningJobsController],
  providers: [
    {
      provide: PLANNING_JOB_REPOSITORY,
      useClass: PlanningJobMongooseRepository,
    },
    { provide: CONTEXT_ENGINE, useClass: ContextEngineHttpClient },
    {
      provide: CONTEXT_GATHERER,
      inject: [ConfigService, CONTEXT_ENGINE],
      useFactory: contextGathererFactory,
    },
    {
      provide: LLM_PLANNER,
      inject: [ConfigService, AnthropicClientProvider],
      useFactory: llmPlannerFactory,
    },
    {
      provide: GATHER_TIMEOUT_MS,
      inject: [ConfigService],
      useFactory: gatherTimeoutMsFactory,
    },
    // Safe to construct unconditionally: its constructor only stores
    // `ConfigService` — `RABBITMQ_URL` is read lazily, inside
    // `getConnection()`, only once something actually needs a connection.
    RabbitMqConnectionProvider,
    {
      provide: CONTEXT_REQUEST_PUBLISHER,
      inject: [ConfigService, RabbitMqConnectionProvider],
      useFactory: contextRequestPublisherFactory,
    },
    {
      provide: GATHER_TIMEOUT_SCHEDULER,
      inject: [ConfigService, getQueueToken(GATHER_TIMEOUT_QUEUE_NAME)],
      useFactory: gatherTimeoutSchedulerFactory,
    },
    {
      provide: ContextResultsConsumer,
      inject: [
        ConfigService,
        RabbitMqConnectionProvider,
        HandleContextResultChunkUseCase,
        EventEmitter2,
      ],
      useFactory: contextResultsConsumerFactory,
    },
    SubmitPlanningJobUseCase,
    GetPlanningJobUseCase,
    ProcessPlanningJobUseCase,
    HandleContextResultChunkUseCase,
    HandleGatherTimeoutUseCase,
    PlanningProcessor,
    // Always registered (mirrors PlanningProcessor): it only ever consumes
    // jobs actually enqueued by `BullMqGatherTimeoutScheduler`, which is
    // itself only constructed when `RABBITMQ_URL` is set — with the
    // transport off, this queue simply never receives any jobs.
    GatherTimeoutProcessor,
    PlanningGateway,
  ],
  exports: [PLANNING_JOB_REPOSITORY, QueueModule],
})
export class ContextModule {}
