import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PLANNING_JOB_REPOSITORY } from './domain/context/planning-job.repository';
import { QueueModule } from './infrastructure/queue/context/queue.module';
import { PlanningJobMongooseRepository } from './infrastructure/persistence/context/planning-job.mongoose.repository';
import {
  PlanningJobOdmEntity,
  PlanningJobSchema,
} from './infrastructure/persistence/context/planning-job.schema';

/**
 * Foundation slice only (branch: feature/context-queue-infra) — persistence
 * + queue wiring for the Context module. No controllers/use-cases yet;
 * those land in later branches, which will inject PLANNING_JOB_REPOSITORY
 * and PROMPT_QUEUE (re-exported via QueueModule) exported here.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlanningJobOdmEntity.name, schema: PlanningJobSchema },
    ]),
    QueueModule,
  ],
  providers: [
    {
      provide: PLANNING_JOB_REPOSITORY,
      useClass: PlanningJobMongooseRepository,
    },
  ],
  exports: [PLANNING_JOB_REPOSITORY, QueueModule],
})
export class ContextModule {}
