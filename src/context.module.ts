import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { GetPlanningJobUseCase } from './application/context/get-planning-job.use-case';
import { ProcessPlanningJobUseCase } from './application/context/process-planning-job.use-case';
import { SubmitPlanningJobUseCase } from './application/context/submit-planning-job.use-case';
import { ConnectorsModule } from './connectors.module';
import {
  CONTEXT_ENGINE,
  ContextEnginePort,
} from './domain/context/context-engine.port';
import {
  CONTEXT_GATHERER,
  ContextGatherer,
} from './domain/context/context-gatherer.port';
import { LLM_PLANNER } from './domain/context/llm-planner.port';
import { PLANNING_JOB_REPOSITORY } from './domain/context/planning-job.repository';
import { ConnectorContextGatherer } from './infrastructure/context/connector-context-gatherer';
import { ContextEngineHttpClient } from './infrastructure/context/context-engine.http-client';
import { StubContextGatherer } from './infrastructure/context/stub-context-gatherer';
import { StubLlmPlanner } from './infrastructure/context/stub-llm-planner';
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
 * Branch: feature/connector-context-engine (roadmap item 7, branch 3) — wires
 * `contextGathererFactory` above as the `CONTEXT_GATHERER` provider.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlanningJobOdmEntity.name, schema: PlanningJobSchema },
    ]),
    QueueModule,
    UsersModule,
    ConnectorsModule,
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
    { provide: LLM_PLANNER, useClass: StubLlmPlanner },
    SubmitPlanningJobUseCase,
    GetPlanningJobUseCase,
    ProcessPlanningJobUseCase,
    PlanningProcessor,
    PlanningGateway,
  ],
  exports: [PLANNING_JOB_REPOSITORY, QueueModule],
})
export class ContextModule {}
