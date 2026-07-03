import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async updateLastActiveAt(id: string): Promise<void> {
    await this.repository.update({ id }, { lastActiveAt: new Date() });
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
