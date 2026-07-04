import { Module } from '@nestjs/common';
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

/**
 * Branch: feature/context-worker — adds REST intake (`PlanningJobsController`)
 * and in-process worker processing (`PlanningProcessor`) on top of Branch 1's
 * persistence + queue foundation. No WebSocket yet (Branch 3).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlanningJobOdmEntity.name, schema: PlanningJobSchema },
    ]),
    QueueModule,
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
  ],
  exports: [PLANNING_JOB_REPOSITORY, QueueModule],
})
export class ContextModule {}
