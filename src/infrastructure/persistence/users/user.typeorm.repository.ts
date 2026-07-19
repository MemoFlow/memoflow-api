import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { User } from '../../../domain/users/user.entity';
import {
  CreateUserData,
  UserRepository,
} from '../../../domain/users/user.repository';
import { UserOrmEntity } from './user.orm-entity';

@Injectable()
export class UserTypeOrmRepository implements UserRepository {
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

  async findTopByXp(limit: number): Promise<User[]> {
    const entities = await this.repository.find({
      order: { xp: 'DESC' },
      take: limit,
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  private toDomain(entity: UserOrmEntity): User {
    return new User({
      id: entity.id,
      email: entity.email,
      passwordHash: entity.passwordHash,
      displayName: entity.displayName,
      role: entity.role,
      xp: entity.xp,
      level: entity.level,
      lastActiveAt: entity.lastActiveAt,
    });
  }
}
