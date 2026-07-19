import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { GetPlanningJobUseCase } from './application/context/get-planning-job.use-case';
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
import { LLM_PLANNER, LlmPlanner } from './domain/context/llm-planner.port';
import { PLANNING_JOB_REPOSITORY } from './domain/context/planning-job.repository';
import { AnthropicLlmPlanner } from './infrastructure/context/anthropic-llm-planner';
import { ConnectorContextGatherer } from './infrastructure/context/connector-context-gatherer';
import { ContextEngineHttpClient } from './infrastructure/context/context-engine.http-client';
import { StubContextGatherer } from './infrastructure/context/stub-context-gatherer';
import { StubLlmPlanner } from './infrastructure/context/stub-llm-planner';
import { AnthropicClientProvider } from './infrastructure/ai/anthropic.client';
import { PlanningJobMongooseRepository } from './infrastructure/persistence/context/planning-job.mongoose.repository';
import {
  PlanningJobOdmEntity,
  PlanningJobSchema,
} from './infrastructure/persistence/context/planning-job.schema';
import { PlanningProcessor } from './infrastructure/queue/context/planning.processor';
import { QueueModule } from './infrastructure/queue/context/queue.module';
import { PlanningJobsController } from './presentation/context/planning-jobs.controller';
import { PlanningGateway } from './presentation/context/planning.gateway';
import { UsersModule } from './users.module';

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

/**
 * Branch: feature/connector-context-engine (roadmap item 7, branch 3) — wires
 * `contextGathererFactory` above as the `CONTEXT_GATHERER` provider. Imports
 * `AiModule` to reuse its exported `AnthropicClientProvider` for
 * `llmPlannerFactory` (roadmap item 5) — a single shared Anthropic client
 * rather than a second instance — and `DocumentsModule` so
 * `SubmitPlanningJobUseCase` can validate an optional `documentId`/
 * `sectionId` binding against `DOCUMENT_REPOSITORY`/`SECTION_REPOSITORY`
 * before writing it into Mongo (also roadmap item 5).
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
    SubmitPlanningJobUseCase,
    GetPlanningJobUseCase,
    ProcessPlanningJobUseCase,
    PlanningProcessor,
    PlanningGateway,
  ],
  exports: [PLANNING_JOB_REPOSITORY, QueueModule],
})
export class ContextModule {}
