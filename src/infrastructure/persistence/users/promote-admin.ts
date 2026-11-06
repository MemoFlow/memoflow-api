import { DataSource } from 'typeorm';
import { USER_ROLE_CHANGED_EVENT } from '../../../domain/audit/audit-events';
import { USER_ENABLED_EVENT } from '../../../domain/users/user-events';
import { UserRole } from '../../../domain/users/user-role';
import { AuditLogOrmEntity } from '../audit/audit-log.orm-entity';
import { UserOrmEntity } from './user.orm-entity';

const AUDIT_SOURCE = 'promote-admin-script';

export type PromoteAdminResult =
  | { status: 'not_found' }
  | { status: 'unchanged'; userId: string }
  | { status: 'promoted'; userId: string; wasDisabled: boolean };

/**
 * Promotes the user with the (already normalized) email to admin and
 * re-enables the account, in ONE transaction together with the `audit_logs`
 * rows describing it. Role changes happen only here (no API), so this is
 * where `user.role_changed` is recorded: the acting user is null (a script,
 * not a session) and the target id is in metadata — no email, no content.
 * Idempotent: an enabled admin changes nothing and writes no audit row.
 */
export async function promoteAdmin(
  dataSource: DataSource,
  email: string,
): Promise<PromoteAdminResult> {
  return dataSource.transaction(async (manager) => {
    const users = manager.getRepository(UserOrmEntity);
    const user = await users.findOne({ where: { email } });
    if (!user) {
      return { status: 'not_found' } as const;
    }
    const wasDisabled = user.disabledAt !== null;
    const roleChanged = user.role !== (UserRole.Admin as string);
    if (!roleChanged && !wasDisabled) {
      return { status: 'unchanged', userId: user.id } as const;
    }

    await users.update(
      { id: user.id },
      { role: UserRole.Admin, disabledAt: null },
    );

    const audit = manager.getRepository(AuditLogOrmEntity);
    const rows: Partial<AuditLogOrmEntity>[] = [];
    if (roleChanged) {
      rows.push({
        userId: null,
        action: USER_ROLE_CHANGED_EVENT,
        metadata: {
          targetUserId: user.id,
          from: user.role,
          to: UserRole.Admin,
          source: AUDIT_SOURCE,
        },
        ip: null,
      });
    }
    if (wasDisabled) {
      rows.push({
        userId: null,
        action: USER_ENABLED_EVENT,
        metadata: { targetUserId: user.id, source: AUDIT_SOURCE },
        ip: null,
      });
    }
    await audit.save(rows.map((row) => audit.create(row)));

    return { status: 'promoted', userId: user.id, wasDisabled } as const;
  });
}
