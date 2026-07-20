import { AuditLog } from './audit-log.entity';

export const AUDIT_LOG_REPOSITORY = Symbol('AuditLogRepository');

export interface SaveAuditLogData {
  userId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  ip: string | null;
}

/**
 * Write-only internal sink — no controller reads this back through the API.
 * `save` is the only method: the audit log is append-only, there is no
 * update/delete path.
 */
export interface AuditLogRepository {
  save(data: SaveAuditLogData): Promise<AuditLog>;
}
