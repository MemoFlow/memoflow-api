import { randomUUID } from 'node:crypto';
import { AuditLog } from '../../domain/audit/audit-log.entity';
import {
  AuditLogRepository,
  SaveAuditLogData,
} from '../../domain/audit/audit-log.repository';
import { RecordAuditEventUseCase } from './record-audit-event.use-case';

class InMemoryAuditLogRepository implements AuditLogRepository {
  public readonly savedData: SaveAuditLogData[] = [];

  save(data: SaveAuditLogData): Promise<AuditLog> {
    this.savedData.push(data);
    return Promise.resolve(
      new AuditLog({
        id: randomUUID(),
        userId: data.userId,
        action: data.action,
        metadata: data.metadata,
        ip: data.ip,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
  }
}

describe('RecordAuditEventUseCase', () => {
  it('persists an audit log row with the given action, userId, metadata, and ip', async () => {
    const repository = new InMemoryAuditLogRepository();
    const useCase = new RecordAuditEventUseCase(repository);

    const result = await useCase.execute({
      action: 'auth.login',
      userId: 'user-1',
      metadata: null,
      ip: '203.0.113.1',
    });

    expect(repository.savedData).toEqual([
      {
        action: 'auth.login',
        userId: 'user-1',
        metadata: null,
        ip: '203.0.113.1',
      },
    ]);
    expect(result.action).toBe('auth.login');
    expect(result.userId).toBe('user-1');
    expect(result.id).toEqual(expect.any(String));
  });

  it('persists a null userId (e.g. an unknown-email failed login) instead of dropping the event', async () => {
    const repository = new InMemoryAuditLogRepository();
    const useCase = new RecordAuditEventUseCase(repository);

    const result = await useCase.execute({
      action: 'auth.login_failed',
      userId: null,
      metadata: { email: 'nobody@example.com' },
      ip: null,
    });

    expect(result.userId).toBeNull();
    expect(result.metadata).toEqual({ email: 'nobody@example.com' });
  });
});
