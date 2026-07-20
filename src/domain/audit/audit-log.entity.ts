/**
 * Domain entity for `audit_logs` (see docs/database-schema.md). Plain
 * TypeScript — no typeorm imports.
 *
 * `userId` is nullable and its FK to `users` is `ON DELETE SET NULL` (same
 * pattern as `templates.created_by`) — the audit trail must outlive a
 * deleted user, so a deleted account's past events are kept, just
 * anonymised rather than cascaded away.
 */
export class AuditLog {
  id: string;
  userId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: Date;

  constructor(props: {
    id: string;
    userId: string | null;
    action: string;
    metadata: Record<string, unknown> | null;
    ip: string | null;
    createdAt: Date;
  }) {
    this.id = props.id;
    this.userId = props.userId;
    this.action = props.action;
    this.metadata = props.metadata;
    this.ip = props.ip;
    this.createdAt = props.createdAt;
  }
}
