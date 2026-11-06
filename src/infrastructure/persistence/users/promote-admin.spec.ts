import { DataSource } from 'typeorm';
import { UserRole } from '../../../domain/users/user-role';
import { AuditLogOrmEntity } from '../audit/audit-log.orm-entity';
import { promoteAdmin } from './promote-admin';
import { UserOrmEntity } from './user.orm-entity';

function makeFakes(user: Partial<UserOrmEntity> | null) {
  const update = jest.fn().mockResolvedValue(undefined);
  const saved: Partial<AuditLogOrmEntity>[] = [];
  const userRepo = {
    findOne: jest.fn().mockResolvedValue(user),
    update,
  };
  const auditRepo = {
    create: jest.fn((row: Partial<AuditLogOrmEntity>) => row),
    save: jest.fn((rows: Partial<AuditLogOrmEntity>[]) => {
      saved.push(...rows);
      return Promise.resolve(rows);
    }),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === UserOrmEntity ? userRepo : auditRepo,
  };
  const dataSource = {
    transaction: (fn: (m: unknown) => Promise<unknown>) => fn(manager),
  } as unknown as DataSource;
  return { dataSource, update, saved, auditRepo };
}

describe('promoteAdmin', () => {
  it('returns not_found without writing', async () => {
    const f = makeFakes(null);
    await expect(promoteAdmin(f.dataSource, 'x@y.com')).resolves.toEqual({
      status: 'not_found',
    });
    expect(f.update).not.toHaveBeenCalled();
    expect(f.auditRepo.save).not.toHaveBeenCalled();
  });

  it('is idempotent for an enabled admin: no update, no audit row', async () => {
    const f = makeFakes({ id: 'u1', role: 'admin', disabledAt: null });
    await expect(promoteAdmin(f.dataSource, 'x@y.com')).resolves.toEqual({
      status: 'unchanged',
      userId: 'u1',
    });
    expect(f.update).not.toHaveBeenCalled();
    expect(f.saved).toEqual([]);
  });

  it('records user.role_changed with a null actor, target id and no email', async () => {
    const f = makeFakes({ id: 'u1', role: 'user', disabledAt: null });
    await expect(promoteAdmin(f.dataSource, 'x@y.com')).resolves.toEqual({
      status: 'promoted',
      userId: 'u1',
      wasDisabled: false,
    });
    expect(f.update).toHaveBeenCalledWith(
      { id: 'u1' },
      { role: UserRole.Admin, disabledAt: null },
    );
    expect(f.saved).toEqual([
      {
        userId: null,
        action: 'user.role_changed',
        metadata: {
          targetUserId: 'u1',
          from: 'user',
          to: 'admin',
          source: 'promote-admin-script',
        },
        ip: null,
      },
    ]);
    expect(JSON.stringify(f.saved)).not.toContain('x@y.com');
  });

  it('records only user.enabled when re-enabling a disabled admin', async () => {
    const f = makeFakes({
      id: 'u1',
      role: 'admin',
      disabledAt: new Date(),
    });
    await promoteAdmin(f.dataSource, 'x@y.com');
    expect(f.saved.map((r) => r.action)).toEqual(['user.enabled']);
  });

  it('records both rows when promoting a disabled non-admin', async () => {
    const f = makeFakes({ id: 'u1', role: 'user', disabledAt: new Date() });
    await promoteAdmin(f.dataSource, 'x@y.com');
    expect(f.saved.map((r) => r.action)).toEqual([
      'user.role_changed',
      'user.enabled',
    ]);
  });
});
