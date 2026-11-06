import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, QueryFailedError, Repository } from 'typeorm';
import { AuthTokenType } from '../../../domain/auth/auth-token';
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

  async verifyEmailWithToken(
    tokenHash: string,
    at: Date,
  ): Promise<string | null> {
    return this.repository.manager.transaction(async (manager) => {
      const userId = await this.lockOwnerAndConsume(
        manager,
        tokenHash,
        AuthTokenType.EmailVerification,
      );
      if (!userId) return null;
      await manager.query(
        `UPDATE "users" SET "email_verified_at" = COALESCE("email_verified_at", $2) WHERE "id" = $1`,
        [userId, at],
      );
      return userId;
    });
  }

  async revokeSessions(id: string): Promise<number> {
    const result: [Array<{ token_version: number }>, number] =
      await this.repository.manager.query(
        `UPDATE "users" SET "token_version" = "token_version" + 1 WHERE "id" = $1 RETURNING "token_version"`,
        [id],
      );
    if (result[0].length === 0) {
      throw new Error('User not found');
    }
    return result[0][0].token_version;
  }

  async changePassword(id: string, passwordHash: string): Promise<number> {
    return this.repository.manager.transaction(async (manager) => {
      // Lock order everywhere: user row first, then token rows.
      // TypeORM's Postgres driver returns `[rows, affectedCount]` for UPDATE.
      const result: [Array<{ token_version: number }>, number] =
        await manager.query(
          `UPDATE "users" SET "password_hash" = $2, "token_version" = "token_version" + 1 WHERE "id" = $1 RETURNING "token_version"`,
          [id, passwordHash],
        );
      const rows = result[0];
      if (rows.length === 0) {
        throw new Error('User not found');
      }
      await manager.query(
        `UPDATE "auth_tokens" SET "used_at" = now() WHERE "user_id" = $1 AND "used_at" IS NULL`,
        [id],
      );
      return rows[0].token_version;
    });
  }

  async resetPasswordWithToken(
    tokenHash: string,
    passwordHash: string,
    at: Date,
  ): Promise<string | null> {
    return this.repository.manager.transaction(async (manager) => {
      const userId = await this.lockOwnerAndConsume(
        manager,
        tokenHash,
        AuthTokenType.PasswordReset,
      );
      if (!userId) return null;
      await manager.query(
        `UPDATE "users" SET "password_hash" = $2, "token_version" = "token_version" + 1, "email_verified_at" = COALESCE("email_verified_at", $3) WHERE "id" = $1`,
        [userId, passwordHash, at],
      );
      await manager.query(
        `UPDATE "auth_tokens" SET "used_at" = $2 WHERE "user_id" = $1 AND "used_at" IS NULL`,
        [userId, at],
      );
      return userId;
    });
  }

  /**
   * Finds the token's owner (unlocked read), locks that user row, rejects a
   * missing or disabled account, then atomically consumes the token. Locking
   * the user before the token rows matches `changePassword`, so concurrent
   * flows cannot deadlock. Returns the owner id, or `null` with nothing
   * changed (the token is not spent unless the final consume succeeds).
   */
  private async lockOwnerAndConsume(
    manager: EntityManager,
    tokenHash: string,
    type: AuthTokenType,
  ): Promise<string | null> {
    const owners: Array<{ user_id: string }> = await manager.query(
      `SELECT "user_id" FROM "auth_tokens" WHERE "token_hash" = $1 AND "type" = $2`,
      [tokenHash, type],
    );
    if (owners.length === 0) return null;
    const userId = owners[0].user_id;

    const users: Array<{ disabled_at: Date | null }> = await manager.query(
      `SELECT "disabled_at" FROM "users" WHERE "id" = $1 FOR UPDATE`,
      [userId],
    );
    if (users.length === 0 || users[0].disabled_at !== null) return null;

    const result: [Array<{ user_id: string }>, number] = await manager.query(
      `UPDATE "auth_tokens" SET "used_at" = now()
       WHERE "token_hash" = $1 AND "type" = $2 AND "used_at" IS NULL AND "expires_at" > now()
       RETURNING "user_id"`,
      [tokenHash, type],
    );
    return result[0][0]?.user_id ?? null;
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
      emailVerifiedAt: entity.emailVerifiedAt,
      tokenVersion: entity.tokenVersion,
    });
  }
}
