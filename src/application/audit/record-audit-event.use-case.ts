import { Inject, Injectable } from '@nestjs/common';
import { AuditLog } from '../../domain/audit/audit-log.entity';
import { AUDIT_LOG_REPOSITORY } from '../../domain/audit/audit-log.repository';
import type { AuditLogRepository } from '../../domain/audit/audit-log.repository';

export interface RecordAuditEventInput {
  action: string;
  userId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
}

/**
 * Persists a single `audit_logs` row. The sole write path onto the audit
 * trail — `AuditListener` is its only caller. Never throws away input: an
 * unknown-user failed login is recorded with `userId: null`, not dropped.
 */
@Injectable()
export class RecordAuditEventUseCase {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async execute(input: RecordAuditEventInput): Promise<AuditLog> {
    return this.auditLogRepository.save({
      userId: input.userId,
      action: input.action,
      metadata: input.metadata,
      ip: input.ip,
    });
  }
}
