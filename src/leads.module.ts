import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GetLeadStatsUseCase } from './application/leads/get-lead-stats.use-case';
import { GetLeadUseCase } from './application/leads/get-lead.use-case';
import { GetOnboardingUseCase } from './application/leads/get-onboarding.use-case';
import { ListLeadsUseCase } from './application/leads/list-leads.use-case';
import { RecalculateLeadScoreUseCase } from './application/leads/recalculate-lead-score.use-case';
import { RecordLeadSignalUseCase } from './application/leads/record-lead-signal.use-case';
import { SubmitOnboardingUseCase } from './application/leads/submit-onboarding.use-case';
import { UpdateConsentUseCase } from './application/leads/update-consent.use-case';
import { LEAD_READ_REPOSITORY } from './domain/leads/lead-read.repository';
import { LEAD_SCORE_REPOSITORY } from './domain/leads/lead-score.repository';
import { LEAD_SIGNAL_REPOSITORY } from './domain/leads/lead-signal.repository';
import { ONBOARDING_PROFILE_REPOSITORY } from './domain/leads/onboarding-profile.repository';
import { LeadReadTypeOrmRepository } from './infrastructure/persistence/leads/lead-read.typeorm.repository';
import { LeadScoreOrmEntity } from './infrastructure/persistence/leads/lead-score.orm-entity';
import { LeadScoreTypeOrmRepository } from './infrastructure/persistence/leads/lead-score.typeorm.repository';
import { LeadSignalOrmEntity } from './infrastructure/persistence/leads/lead-signal.orm-entity';
import { LeadSignalTypeOrmRepository } from './infrastructure/persistence/leads/lead-signal.typeorm.repository';
import { OnboardingProfileOrmEntity } from './infrastructure/persistence/leads/onboarding-profile.orm-entity';
import { OnboardingProfileTypeOrmRepository } from './infrastructure/persistence/leads/onboarding-profile.typeorm.repository';
import { LeadScoreListener } from './presentation/leads/lead-score.listener';
import { LeadsController } from './presentation/leads/leads.controller';
import { LeadSignalsController } from './presentation/leads/lead-signals.controller';
import { OnboardingController } from './presentation/leads/onboarding.controller';
import { ConnectorsModule } from './connectors.module';
import { UsersModule } from './users.module';

/**
 * Onboarding answers, behaviour signals and the stored lead score (PG).
 * `ConnectorsModule` exports `CONNECTOR_CONNECTION_REPOSITORY`, which the
 * recalculation reads. `LeadScoreListener` is a plain provider: the global
 * `EventEmitterModule` discovers its `@OnEvent` methods.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OnboardingProfileOrmEntity,
      LeadSignalOrmEntity,
      LeadScoreOrmEntity,
    ]),
    UsersModule,
    ConnectorsModule,
  ],
  controllers: [OnboardingController, LeadSignalsController, LeadsController],
  providers: [
    {
      provide: ONBOARDING_PROFILE_REPOSITORY,
      useClass: OnboardingProfileTypeOrmRepository,
    },
    { provide: LEAD_SIGNAL_REPOSITORY, useClass: LeadSignalTypeOrmRepository },
    { provide: LEAD_SCORE_REPOSITORY, useClass: LeadScoreTypeOrmRepository },
    { provide: LEAD_READ_REPOSITORY, useClass: LeadReadTypeOrmRepository },
    RecalculateLeadScoreUseCase,
    GetOnboardingUseCase,
    SubmitOnboardingUseCase,
    UpdateConsentUseCase,
    RecordLeadSignalUseCase,
    ListLeadsUseCase,
    GetLeadUseCase,
    GetLeadStatsUseCase,
    LeadScoreListener,
  ],
})
export class LeadsModule {}
