import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AuthTokenRepository,
  IssueAuthTokenData,
} from '../../../domain/auth/auth-token.repository';
import { AuthTokenOrmEntity } from './auth-token.orm-entity';

@Injectable()
export class AuthTokenTypeOrmRepository implements AuthTokenRepository {
  constructor(
    @InjectRepository(AuthTokenOrmEntity)
    private readonly repository: Repository<AuthTokenOrmEntity>,
  ) {}

  async issue(data: IssueAuthTokenData): Promise<boolean> {
    return this.repository.manager.transaction(async (manager) => {
      // Serialize concurrent issues for the same account + type so the
      // interval check below cannot be raced by a parallel request.
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${data.userId}:${data.type}`,
      ]);
      const inserted: unknown[] = await manager.query(
        `INSERT INTO "auth_tokens" ("user_id", "type", "token_hash", "expires_at")
         SELECT $1::uuid, $2::varchar, $3::varchar, $4::timestamptz
         WHERE NOT EXISTS (
           SELECT 1 FROM "auth_tokens"
           WHERE "user_id" = $1::uuid AND "type" = $2::varchar
             AND "created_at" > now() - ($5::double precision * interval '1 millisecond')
         )
         RETURNING "id"`,
        [
          data.userId,
          data.type,
          data.tokenHash,
          data.expiresAt,
          data.minIntervalMs,
        ],
      );
      return inserted.length > 0;
    });
  }
}
