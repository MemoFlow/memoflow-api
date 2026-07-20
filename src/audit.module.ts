import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordAuditEventUseCase } from './application/audit/record-audit-event.use-case';
import { AUDIT_LOG_REPOSITORY } from './domain/audit/audit-log.repository';
import { AuditLogOrmEntity } from './infrastructure/persistence/audit/audit-log.orm-entity';
import { AuditLogTypeOrmRepository } from './infrastructure/persistence/audit/audit-log.typeorm.repository';
import { AuditListener } from './presentation/audit/audit.listener';

/**
 * Security-hardening plan, slice 5 — audit log (PG, `audit_logs`). No
 * controller: this is a write-only internal sink, consumed only through
 * domain events emitted by other features (auth, connectors, ai).
 *
 * `AuditListener` is registered as a plain provider (not a controller) —
 * mirrors `GamificationListener` in `GamificationModule`: Nest's
 * `EventEmitterModule` discovery service finds `@OnEvent` methods on any
 * provider in the graph, and `EventEmitterModule.forRoot()` (registered
 * globally in `AppModule`) makes `EventEmitter2` itself available to the
 * emitting features without a separate import here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLogOrmEntity])],
  providers: [
    { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogTypeOrmRepository },
    RecordAuditEventUseCase,
    AuditListener,
  ],
  exports: [AUDIT_LOG_REPOSITORY],
})
export class AuditModule {}
