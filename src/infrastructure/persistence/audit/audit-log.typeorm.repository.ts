import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../../domain/audit/audit-log.entity';
import {
  AuditLogRepository,
  SaveAuditLogData,
} from '../../../domain/audit/audit-log.repository';
import { AuditLogOrmEntity } from './audit-log.orm-entity';

@Injectable()
export class AuditLogTypeOrmRepository implements AuditLogRepository {
  constructor(
    @InjectRepository(AuditLogOrmEntity)
    private readonly repository: Repository<AuditLogOrmEntity>,
  ) {}

  async save(data: SaveAuditLogData): Promise<AuditLog> {
    const entity = this.repository.create({
      userId: data.userId,
      action: data.action,
      metadata: data.metadata,
      ip: data.ip,
    });
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  private toDomain(entity: AuditLogOrmEntity): AuditLog {
    return new AuditLog({
      id: entity.id,
      userId: entity.userId,
      action: entity.action,
      metadata: entity.metadata,
      ip: entity.ip,
      createdAt: entity.createdAt,
    });
  }
}
