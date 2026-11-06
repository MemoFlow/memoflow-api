import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import { UserRole } from '../../../domain/users/user-role';
import { User } from '../../../domain/users/user.entity';
import {
  CreateUserData,
  UserRepository,
} from '../../../domain/users/user.repository';
import { UserOrmEntity } from './user.orm-entity';

@Injectable()
export class UserTypeOrmRepository implements UserRepository {
  private readonly logger = new Logger(UserTypeOrmRepository.name);

  constructor(
    @InjectRepository(UserOrmEntity)
    private readonly repository: Repository<UserOrmEntity>,
  ) {}

  async findById(id: string): Promise<User | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const entity = await this.repository.findOne({ where: { email } });
    return entity ? this.toDomain(entity) : null;
  }

  async create(data: CreateUserData): Promise<User> {
    const entity = this.repository.create({
      email: data.email,
      passwordHash: data.passwordHash,
      displayName: data.displayName,
    });
    try {
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (err) {
      // The use-case pre-checks the email, but two concurrent registrations
      // can both pass that check and race to INSERT. The DB unique constraint
      // is the real guard; map its violation (Postgres 23505) to a 409 so the
      // loser gets the documented ConflictException instead of a 500.
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw err;
    }
  }

  async updateLastActiveAt(id: string): Promise<void> {
    await this.repository.update({ id }, { lastActiveAt: new Date() });
  }

  async setDisabledAt(id: string, disabledAt: Date | null): Promise<void> {
    await this.repository.update({ id }, { disabledAt });
  }

  async findTopByXp(limit: number): Promise<User[]> {
    const entities = await this.repository.find({
      where: { disabledAt: IsNull() },
      order: { xp: 'DESC' },
      take: limit,
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  /**
   * Narrows the stored varchar to `UserRole` once, here. An unrecognised
   * value fails closed to the least-privileged role.
   */
  private toRole(entity: UserOrmEntity): UserRole {
    if (entity.role === (UserRole.Admin as string)) return UserRole.Admin;
    if (entity.role !== (UserRole.User as string)) {
      this.logger.warn(
        `Unknown role "${entity.role}" for user ${entity.id}; treating as "${UserRole.User}"`,
      );
    }
    return UserRole.User;
  }

  private toDomain(entity: UserOrmEntity): User {
    return new User({
      id: entity.id,
      email: entity.email,
      passwordHash: entity.passwordHash,
      displayName: entity.displayName,
      role: this.toRole(entity),
      xp: entity.xp,
      level: entity.level,
      lastActiveAt: entity.lastActiveAt,
      disabledAt: entity.disabledAt,
    });
  }
}
