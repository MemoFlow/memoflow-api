import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { GetPlanningJobUseCase } from './application/context/get-planning-job.use-case';
import { ProcessPlanningJobUseCase } from './application/context/process-planning-job.use-case';
import { SubmitPlanningJobUseCase } from './application/context/submit-planning-job.use-case';
import { CONTEXT_GATHERER } from './domain/context/context-gatherer.port';
import { LLM_PLANNER } from './domain/context/llm-planner.port';
import { PLANNING_JOB_REPOSITORY } from './domain/context/planning-job.repository';
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
 * Branch: feature/context-websocket — adds the real-time `PlanningGateway`
 * (WebSocket push of `planning.*` events) on top of Branch 2's REST intake
 * and in-process worker processing. `EventEmitterModule` is already
 * registered globally in `AppModule`; the gateway just subscribes to it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlanningJobOdmEntity.name, schema: PlanningJobSchema },
    ]),
    QueueModule,
    UsersModule,
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
    { provide: CONTEXT_GATHERER, useClass: StubContextGatherer },
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
