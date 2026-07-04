import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ConnectorConnection } from '../../../domain/connectors/connector-connection.entity';
import {
  ConnectorConnectionRepository,
  UpdateConnectorStatusData,
  UpsertInitiatedData,
} from '../../../domain/connectors/connector-connection.repository';
import { ConnectorProvider } from '../../../domain/connectors/connector-provider';
import { ConnectorStatus } from '../../../domain/connectors/connector-status';
import { ConnectorConnectionOrmEntity } from './connector-connection.orm-entity';

@Injectable()
export class ConnectorConnectionTypeOrmRepository implements ConnectorConnectionRepository {
  constructor(
    @InjectRepository(ConnectorConnectionOrmEntity)
    private readonly repository: Repository<ConnectorConnectionOrmEntity>,
  ) {}

  async findById(id: string): Promise<ConnectorConnection | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByUserAndProvider(
    userId: string,
    provider: ConnectorProvider,
  ): Promise<ConnectorConnection | null> {
    const entity = await this.repository.findOne({
      where: { userId, provider },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findAllByUser(userId: string): Promise<ConnectorConnection[]> {
    const entities = await this.repository.find({ where: { userId } });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findActiveByUser(userId: string): Promise<ConnectorConnection[]> {
    const entities = await this.repository.find({
      where: { userId, status: ConnectorStatus.Active },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async upsertInitiated(
    data: UpsertInitiatedData,
  ): Promise<ConnectorConnection> {
    const existing = await this.repository.findOne({
      where: { userId: data.userId, provider: data.provider },
    });

    if (existing) {
      await this.repository.update(
        { id: existing.id },
        {
          composioAccountId: data.composioAccountId,
          status: ConnectorStatus.Initiated,
          connectedAt: null,
        },
      );
      return (await this.findById(existing.id)) as ConnectorConnection;
    }

    const entity = this.repository.create({
      userId: data.userId,
      provider: data.provider,
      composioAccountId: data.composioAccountId,
      status: ConnectorStatus.Initiated,
      connectedAt: null,
    });

    try {
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (err) {
      // Two concurrent "connect" calls for the same user+provider can both
      // pass the pre-check above and race to INSERT; the unique
      // (user_id, provider) constraint is the real guard. The loser falls
      // back to an update against the row the winner just created, so the
      // caller always gets a fresh `Initiated` row instead of a 500.
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === '23505'
      ) {
        const winner = await this.repository.findOneOrFail({
          where: { userId: data.userId, provider: data.provider },
        });
        await this.repository.update(
          { id: winner.id },
          {
            composioAccountId: data.composioAccountId,
            status: ConnectorStatus.Initiated,
            connectedAt: null,
          },
        );
        return (await this.findById(winner.id)) as ConnectorConnection;
      }
      throw err;
    }
  }

  async updateStatus(
    id: string,
    patch: UpdateConnectorStatusData,
  ): Promise<ConnectorConnection | null> {
    const existing = await this.repository.findOne({ where: { id } });
    if (!existing) return null;

    await this.repository.update(
      { id },
      {
        status: patch.status,
        ...(patch.composioAccountId !== undefined
          ? { composioAccountId: patch.composioAccountId }
          : {}),
        ...(patch.connectedAt !== undefined
          ? { connectedAt: patch.connectedAt }
          : {}),
      },
    );
    return this.findById(id);
  }

  private toDomain(entity: ConnectorConnectionOrmEntity): ConnectorConnection {
    return new ConnectorConnection({
      id: entity.id,
      userId: entity.userId,
      provider: entity.provider as ConnectorProvider,
      composioAccountId: entity.composioAccountId,
      status: entity.status as ConnectorStatus,
      connectedAt: entity.connectedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}
